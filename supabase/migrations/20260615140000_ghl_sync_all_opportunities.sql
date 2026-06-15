-- ============================================================================
-- Drop the pipeline-selection requirement from the GHL sync.
--
-- The funnel model is tag-driven (cohort by contact tags) + revenue from won
-- opportunities. It does NOT use pipeline stages, so scoping the opportunity
-- pull to selected pipelines is pointless — and it created a confusing UX
-- where "Sync now" was hidden until pipelines were picked, and a configured
-- client still synced nothing.
--
-- New behavior: after contacts, the cron job does ONE unfiltered
-- /opportunities/search pass (all opportunities for the location, paginated),
-- then enrich + finalize. ghl_selected_pipeline_ids is ignored.
--
-- Only the contacts-done branch of ghl_cron_tick changes; everything else is
-- reproduced verbatim (CREATE OR REPLACE needs the whole body).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ghl_cron_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_job   RECORD;
  v_resp  RECORD;
  v_out   JSONB;
  v_next_pipeline TEXT;
  v_req   BIGINT;
  v_advanced INT := 0;
  v_summary JSONB;
BEGIN
  FOR v_job IN
    SELECT j.*, o.ghl_selected_pipeline_ids
      FROM public.ghl_sync_jobs j
      JOIN public.organizations o ON o.id = j.org_id
     WHERE j.status IN ('queued','running')
     ORDER BY j.queued_at
     LIMIT 10
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    BEGIN
      IF v_job.status = 'queued' THEN
        v_req := public._ghl_dispatch_contacts_page(v_job.org_id, NULL, NULL);
        UPDATE public.ghl_sync_jobs
           SET status = 'running', phase = 'contacts',
               pipeline_queue = '{}',
               in_flight_request_id = v_req, started_at = now(), error = NULL
         WHERE id = v_job.id;
        v_advanced := v_advanced + 1;
        CONTINUE;
      END IF;

      SELECT id, status_code, content, error_msg
        INTO v_resp FROM net._http_response
       WHERE id = v_job.in_flight_request_id;
      IF v_resp.id IS NULL THEN CONTINUE; END IF;

      IF v_resp.error_msg IS NOT NULL OR v_resp.status_code NOT BETWEEN 200 AND 299 THEN
        IF v_job.retry_count >= 3 THEN
          UPDATE public.ghl_sync_jobs
             SET status = 'error', finished_at = now(),
                 error = format('HTTP %s after %s retries (%s phase): %s',
                                COALESCE(v_resp.status_code, 0), v_job.retry_count,
                                v_job.phase, COALESCE(v_resp.error_msg, left(v_resp.content, 300)))
           WHERE id = v_job.id;
          UPDATE public.organizations
             SET ghl_last_sync_error = format('sync failed in %s phase: HTTP %s',
                                              v_job.phase, COALESCE(v_resp.status_code, 0))
           WHERE id = v_job.org_id;
          UPDATE public.sync_state
             SET consecutive_failures = consecutive_failures + 1,
                 last_error = format('HTTP %s in %s phase', COALESCE(v_resp.status_code,0), v_job.phase),
                 last_error_at = now(), updated_at = now()
           WHERE org_id = v_job.org_id AND resource = 'opportunities';
        ELSE
          IF v_job.phase = 'contacts' THEN
            v_req := public._ghl_dispatch_contacts_page(v_job.org_id, v_job.cursor, v_job.cursor_id);
          ELSE
            v_req := public._ghl_dispatch_opps_page(v_job.org_id, v_job.current_pipeline, v_job.cursor, v_job.cursor_id);
          END IF;
          UPDATE public.ghl_sync_jobs
             SET retry_count = retry_count + 1, in_flight_request_id = v_req
           WHERE id = v_job.id;
        END IF;
        v_advanced := v_advanced + 1;
        CONTINUE;
      END IF;

      -- Success: process according to phase.
      IF v_job.phase = 'contacts' THEN
        v_out := public._ghl_process_contacts_body(v_job.org_id, v_resp.content::jsonb);
        IF (v_out->>'next_cursor') IS NOT NULL THEN
          v_req := public._ghl_dispatch_contacts_page(
            v_job.org_id, v_out->>'next_cursor', v_out->>'next_cursor_id');
          UPDATE public.ghl_sync_jobs
             SET rows_contacts = rows_contacts + (v_out->>'rows_synced')::int,
                 cursor = v_out->>'next_cursor', cursor_id = v_out->>'next_cursor_id',
                 in_flight_request_id = v_req, retry_count = 0
           WHERE id = v_job.id;
        ELSE
          -- ── CHANGED ── Contacts done → ONE unfiltered opportunities pass.
          -- Pull all opportunities for the location (pipeline_id omitted);
          -- pipeline selection is irrelevant to the tag-driven model.
          v_req := public._ghl_dispatch_opps_page(v_job.org_id, NULL, NULL, NULL);
          UPDATE public.ghl_sync_jobs
             SET rows_contacts = rows_contacts + (v_out->>'rows_synced')::int,
                 phase = 'opportunities',
                 current_pipeline = NULL,
                 pipeline_queue = '{}',
                 cursor = NULL, cursor_id = NULL,
                 in_flight_request_id = v_req, retry_count = 0
           WHERE id = v_job.id;
        END IF;

      ELSIF v_job.phase = 'opportunities' THEN
        v_out := public._ghl_process_opps_body(v_job.org_id, v_resp.content::jsonb);
        IF (v_out->>'next_cursor') IS NOT NULL THEN
          v_req := public._ghl_dispatch_opps_page(
            v_job.org_id, v_job.current_pipeline, v_out->>'next_cursor', v_out->>'next_cursor_id');
          UPDATE public.ghl_sync_jobs
             SET rows_opportunities = rows_opportunities + (v_out->>'rows_synced')::int,
                 cursor = v_out->>'next_cursor', cursor_id = v_out->>'next_cursor_id',
                 in_flight_request_id = v_req, retry_count = 0
           WHERE id = v_job.id;
        ELSE
          -- All opportunities drained → enrich + finalize → done.
          PERFORM public._ghl_enrich_internal(v_job.org_id);
          v_summary := public._ghl_finalize_internal(v_job.org_id);
          UPDATE public.ghl_sync_jobs
             SET rows_opportunities = rows_opportunities + (v_out->>'rows_synced')::int,
                 status = 'done', phase = 'finalizing', result = v_summary,
                 finished_at = now(), in_flight_request_id = NULL
           WHERE id = v_job.id;
        END IF;
      END IF;

      v_advanced := v_advanced + 1;

    EXCEPTION WHEN others THEN
      UPDATE public.ghl_sync_jobs
         SET status = 'error', error = 'tick exception: ' || SQLERRM, finished_at = now()
       WHERE id = v_job.id;
    END;
  END LOOP;

  RETURN jsonb_build_object('advanced', v_advanced);
END $$;
REVOKE ALL ON FUNCTION public.ghl_cron_tick() FROM PUBLIC, anon, authenticated;
