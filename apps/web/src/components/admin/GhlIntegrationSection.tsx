// Admin-only panel on the Client Detail page.
//
// Flow:
//   1. Admin enters GHL Location ID + PIT token
//   2. Clicks "Test & Save" — backend does test_connection_start, we poll
//      ghl_request_result until done. On success: ghl_save_config writes
//      location_id + token. On failure: show error, don't save.
//   3. After save, "Fetch Pipelines" appears. Calls list_pipelines_start +
//      poll. Shows checkbox list of pipelines.
//   4. For each picked pipeline, a per-stage dropdown maps stages →
//      KPI channel (contact / net / offer / contract).
//   5. Admin enters the GHL custom field key for "spend" (optional).
//   6. "Save Config & Activate" persists the mapping and flips status=active.
//
// Polling: pg_net is asynchronous; net.http_get only fires on transaction
// commit. We get back a request_id from a *_start RPC, then poll
// ghl_request_result(id) every 400ms for up to ~20s.

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { S1, S2, B1, TEXT, T2, T3, G, RED, AMBER } from "@/shared/kpi";
import GhlChannelManagerPanel from "./GhlChannelManagerPanel";

const IS: React.CSSProperties = {
  width: "100%",
  background: S2,
  border: "1px solid " + B1,
  borderRadius: 8,
  color: TEXT,
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const BTN_PRIMARY: React.CSSProperties = {
  background: G,
  border: "none",
  borderRadius: 8,
  padding: "10px 22px",
  color: "#000",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "inherit",
};

const BTN_GHOST: React.CSSProperties = {
  background: "transparent",
  border: "1px solid " + B1,
  borderRadius: 8,
  padding: "9px 18px",
  color: TEXT,
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

interface Stage {
  id: string;
  name: string;
  position?: number;
}
interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

/**
 * Wait for a pg_net request to complete by polling ghl_request_result.
 * Returns the response envelope { ok, status, body, error } or throws on timeout.
 */
async function waitForRequest(reqId: number, opts: { timeoutMs?: number; intervalMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const intervalMs = opts.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc("ghl_request_result", { p_request_id: reqId });
    if (error) throw error;
    if (data && (data as any).pending === false) return data as any;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for GHL response after ${timeoutMs}ms`);
}

export default function GhlIntegrationSection({ orgId }: { orgId: string }) {
  const qc = useQueryClient();

  // ─── Load existing config from organizations ───────────────────────────
  const { data: org, isLoading } = useQuery({
    queryKey: ["admin-org-ghl", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select(
          "id, name, ghl_location_id, ghl_selected_pipeline_ids, ghl_stage_mapping, ghl_spend_field, ghl_status, ghl_last_sync_at, ghl_last_sync_error",
        )
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  // Has-saved-credentials is inferred from ghl_location_id being non-null.
  // (We can't read ghl_pit_token from the browser — service_role only.)
  const hasSavedCreds = !!org?.ghl_location_id;

  // ─── Latest sync summary (kpi_periods.data.ghl_channel for current month) ──
  const { data: ghlSummary } = useQuery({
    queryKey: ["admin-org-ghl-summary", orgId, org?.ghl_last_sync_at],
    enabled: !!org?.ghl_last_sync_at,
    queryFn: async () => {
      const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
        .toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("kpi_periods")
        .select("data, period_start, updated_at")
        .eq("org_id", orgId)
        .eq("period_start", periodStart)
        .maybeSingle();
      if (error) throw error;
      return (data?.data as any)?.ghl_channel || null;
    },
  });

  // ─── Latest server-side sync job (queued/running → poll every 3s) ─────────
  const { data: syncJob } = useQuery({
    queryKey: ["ghl-sync-job", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ghl_sync_jobs")
        .select("*")
        .eq("org_id", orgId)
        .order("queued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    refetchInterval: (query) => {
      const j = query.state.data as any;
      return j && (j.status === "queued" || j.status === "running") ? 3000 : false;
    },
  });
  const jobActive = syncJob && (syncJob.status === "queued" || syncJob.status === "running");

  // ─── Form state ─────────────────────────────────────────────────────────
  const [locationId, setLocationId] = useState("");
  const [pitToken, setPitToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<null | "test" | "fetch" | "save" | "sync">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [spendField, setSpendField] = useState("");

  // Hydrate from server once
  useEffect(() => {
    if (!org) return;
    setLocationId(org.ghl_location_id || "");
    setSelectedPipelineIds(org.ghl_selected_pipeline_ids || []);
    setSpendField(org.ghl_spend_field || "");
  }, [org]);

  // When a job finishes, refresh the org + summary data so the new numbers show.
  const prevJobStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = syncJob?.status ?? null;
    if (prevJobStatus.current && prevJobStatus.current !== status && (status === "done" || status === "error")) {
      qc.invalidateQueries({ queryKey: ["admin-org-ghl", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-org-ghl-summary", orgId] });
    }
    prevJobStatus.current = status;
  }, [syncJob?.status]);

  // ─── Actions ────────────────────────────────────────────────────────────

  async function handleTestAndSave() {
    setMsg(null);
    if (!locationId.trim() || !pitToken.trim()) {
      setMsg({ kind: "err", text: "Location ID and PIT token are both required." });
      return;
    }
    setBusy("test");
    try {
      const { data: reqId, error } = await supabase.rpc("ghl_test_connection_start", {
        p_location_id: locationId.trim(),
        p_pit_token: pitToken.trim(),
      });
      if (error) throw error;
      const result = await waitForRequest(Number(reqId));
      if (!result.ok) {
        setMsg({
          kind: "err",
          text: `GHL rejected the credentials (HTTP ${result.status}): ${result.body?.message || result.error || "unknown"}`,
        });
        return;
      }
      // Test passed → persist. We always re-save the token here, in case
      // it was a rotated one.
      const { error: saveErr } = await supabase.rpc("ghl_save_config", {
        p_org_id: orgId,
        p_location_id: locationId.trim(),
        p_pit_token: pitToken.trim(),
      });
      if (saveErr) throw saveErr;
      setPitToken(""); // clear from local state for safety
      setMsg({
        kind: "ok",
        text: `Connected to "${result.body?.location?.name || result.body?.name || "(unknown)"}". Credentials saved.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-org-ghl", orgId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleFetchPipelines() {
    setMsg(null);
    setBusy("fetch");
    try {
      const { data: reqId, error } = await supabase.rpc("ghl_list_pipelines_start", { p_org_id: orgId });
      if (error) throw error;
      const result = await waitForRequest(Number(reqId));
      if (!result.ok) {
        setMsg({
          kind: "err",
          text: `GHL returned HTTP ${result.status}: ${result.body?.message || result.error || "unknown"}`,
        });
        return;
      }
      const list: Pipeline[] = result.body?.pipelines || [];
      setPipelines(list);
      setMsg({ kind: "ok", text: `Fetched ${list.length} pipeline(s) from GHL.` });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  // ─── Sync now: queue a server-side job; pg_cron does the actual work ──────
  // The cron tick (every 10s) paginates GHL, upserts, enriches, and finalizes
  // entirely inside Postgres. We just enqueue and poll the job row — closing
  // the tab no longer kills a sync.
  async function handleSyncNow() {
    setMsg(null);
    setBusy("sync");
    try {
      // No pipeline gating — the sync pulls all opportunities for the location.
      const { error } = await supabase.rpc("ghl_queue_sync", { p_org_id: orgId });
      if (error) throw error;
      setMsg({ kind: "info", text: "Sync queued. The server picks it up within ~10 seconds — progress below. You can close this tab; the sync keeps running." });
      qc.invalidateQueries({ queryKey: ["ghl-sync-job", orgId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: `Couldn't queue sync: ${e?.message || e}` });
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveConfig(activate: boolean) {
    setMsg(null);
    setBusy("save");
    try {
      const { error } = await supabase.rpc("ghl_save_config", {
        p_org_id: orgId,
        p_location_id: locationId || null,
        p_pit_token: null, // don't overwrite the saved token
        p_selected_pipeline_ids: selectedPipelineIds,
        // stage_mapping is no longer used by the simplified finalize; pass {}.
        p_stage_mapping: {},
        p_spend_field: spendField || null,
        p_activate: activate,
      });
      if (error) throw error;
      setMsg({ kind: "ok", text: activate ? "Saved and activated. Nightly sync will pick it up." : "Configuration saved." });
      qc.invalidateQueries({ queryKey: ["admin-org-ghl", orgId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  if (isLoading) return null;

  const statusColor = org?.ghl_status === "active" ? G : org?.ghl_status === "error" ? RED : T3;

  return (
    <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: 24, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>🔌 GoHighLevel Integration</div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: statusColor, fontWeight: 700 }}>
          {org?.ghl_status || "inactive"}
        </div>
      </div>
      <div style={{ fontSize: 12, color: T3, marginBottom: 18 }}>
        Pulls opportunities from this client's GHL location nightly. Admin-only; never visible to clients.
      </div>

      {msg && (
        <div
          style={{
            background: (msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER) + "15",
            border: "1px solid " + (msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER) + "40",
            color: msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER,
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {msg.text}
        </div>
      )}

      {/* ─── Stage 1: credentials ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Location ID (PID)
          </div>
          <input
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="e.g. abc123XYZ"
            style={IS}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Personal Integration Token {hasSavedCreds && <span style={{ color: G, textTransform: "none", letterSpacing: 0, fontSize: 10 }}> · saved</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={showToken ? "text" : "password"}
              value={pitToken}
              onChange={(e) => setPitToken(e.target.value)}
              placeholder={hasSavedCreds ? "(leave blank to keep saved token)" : "pit-..."}
              style={{ ...IS, flex: 1 }}
            />
            <button onClick={() => setShowToken((v) => !v)} style={{ ...BTN_GHOST, padding: "8px 12px" }}>
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <button onClick={handleTestAndSave} disabled={busy !== null} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>
          {busy === "test" ? "Testing…" : hasSavedCreds ? "Re-test & update credentials" : "Test & save credentials"}
        </button>
        {hasSavedCreds && (
          <button onClick={handleFetchPipelines} disabled={busy !== null} style={{ ...BTN_GHOST, opacity: busy ? 0.6 : 1 }}>
            {busy === "fetch" ? "Fetching…" : pipelines ? "Re-fetch pipelines" : "Fetch pipelines from GHL"}
          </button>
        )}
      </div>

      {/* ─── Stage 2: pipeline selection ─── */}
      {pipelines && pipelines.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Pipelines to sync</div>
            <div style={{ fontSize: 11, color: T3 }}>
              ({selectedPipelineIds.length} of {pipelines.length} selected · raw stage counts will be summed across all picked pipelines)
            </div>
            <button
              onClick={() => setSelectedPipelineIds(pipelines.map((p) => p.id))}
              style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 11, marginLeft: "auto" }}
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedPipelineIds([])}
              style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 11 }}
            >
              Clear
            </button>
          </div>
          <div style={{ background: S2, borderRadius: 10, padding: 14, marginBottom: 16, maxHeight: 280, overflowY: "auto" }}>
            {pipelines.map((p) => {
              const isSelected = selectedPipelineIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, padding: "5px 0" }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) =>
                      setSelectedPipelineIds((cur) =>
                        e.target.checked ? [...cur, p.id] : cur.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: T3 }}>({p.stages?.length || 0} stages)</span>
                </label>
              );
            })}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: T3, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
              Spend custom field key (GHL custom field id/name)
            </div>
            <input
              value={spendField}
              onChange={(e) => setSpendField(e.target.value)}
              placeholder="e.g. ad_spend (leave blank to keep spend manual)"
              style={IS}
            />
            <div style={{ fontSize: 11, color: T3, marginTop: 4 }}>
              Sync reads this custom field on each opportunity to populate the "spend" KPI. If blank, spend stays manual.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => handleSaveConfig(false)} disabled={busy !== null} style={{ ...BTN_GHOST, opacity: busy ? 0.6 : 1 }}>
              {busy === "save" ? "Saving…" : "Save without activating"}
            </button>
            <button onClick={() => handleSaveConfig(true)} disabled={busy !== null} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>
              {busy === "save" ? "Saving…" : "Save & activate nightly sync"}
            </button>
          </div>
        </>
      )}

      {/* ─── Channel manager — per-channel source + stage rules ─── */}
      {hasSavedCreds && <GhlChannelManagerPanel orgId={orgId} />}

      {/* ─── Sync controls (available once credentials are saved) ─── */}
      {hasSavedCreds && (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid " + B1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={handleSyncNow}
              disabled={busy !== null || !!jobActive}
              style={{ ...BTN_PRIMARY, opacity: busy || jobActive ? 0.6 : 1 }}
            >
              {jobActive ? "Sync in progress…" : busy === "sync" ? "Queuing…" : "Sync now"}
            </button>
            {jobActive && (
              <span style={{ fontSize: 12, color: T2 }}>
                {syncJob.status === "queued"
                  ? "Queued — server picks it up within ~10s…"
                  : `Running · ${syncJob.phase} · ${Number(syncJob.rows_contacts || 0).toLocaleString()} contacts · ${Number(syncJob.rows_opportunities || 0).toLocaleString()} opportunities`}
              </span>
            )}
          </div>
          {/* Last finished job result */}
          {!jobActive && syncJob?.status === "done" && syncJob.result && (
            <div style={{ fontSize: 12, color: G, marginTop: 8 }}>
              Last sync: {Number(syncJob.rows_contacts || 0).toLocaleString()} contacts · {Number(syncJob.rows_opportunities || 0).toLocaleString()} opportunities ·
              {" "}{syncJob.result.months_touched} month(s) updated · {syncJob.result.total_won_deals} won deals · ${Number(syncJob.result.total_won_revenue || 0).toLocaleString()} revenue
              {" "}({syncJob.finished_at ? new Date(syncJob.finished_at).toLocaleString() : ""})
            </div>
          )}
          {!jobActive && syncJob?.status === "error" && (
            <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>
              Last sync failed: {syncJob.error}
            </div>
          )}
          <div style={{ fontSize: 11, color: T3, marginTop: 6 }}>
            Runs server-side via pg_cron — safe to close this tab. Also runs automatically every night at 02:00 UTC for all active GHL clients.
          </div>
        </div>
      )}

      {/* ─── Latest sync summary (reads kpi_periods.data.ghl_channel) ─── */}
      {ghlSummary && (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid " + B1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>📊 This month's GHL snapshot</div>
            <div style={{ fontSize: 11, color: T3 }}>
              {Number(ghlSummary.total_opportunities || 0).toLocaleString()} opportunities ·
              ${Number(ghlSummary.total_spend || 0).toLocaleString()} spend ·
              {Array.isArray(ghlSummary.stage_totals) ? ` ${ghlSummary.stage_totals.length} stages` : ""}
            </div>
          </div>

          {/* Stage totals table — counts by stage NAME, summed across selected pipelines */}
          {Array.isArray(ghlSummary.stage_totals) && ghlSummary.stage_totals.length > 0 && (
            <div style={{ background: S2, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                Stage totals
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: T3, fontSize: 11, textAlign: "left" }}>
                    <th style={{ padding: "4px 8px", borderBottom: "1px solid " + B1, fontWeight: 500 }}>Stage</th>
                    <th style={{ padding: "4px 8px", borderBottom: "1px solid " + B1, fontWeight: 500, textAlign: "right" }}>Count</th>
                    <th style={{ padding: "4px 8px", borderBottom: "1px solid " + B1, fontWeight: 500, textAlign: "right" }}>Pipelines</th>
                  </tr>
                </thead>
                <tbody>
                  {ghlSummary.stage_totals.map((s: any, i: number) => (
                    <tr key={i}>
                      <td style={{ padding: "5px 8px", fontWeight: 500 }}>{s.stage_name}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: G }}>
                        {Number(s.count).toLocaleString()}
                      </td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: T3 }}>{s.pipelines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Per-pipeline breakdown (collapsed by default if many) */}
          {Array.isArray(ghlSummary.pipeline_breakdown) && ghlSummary.pipeline_breakdown.length > 0 && (
            <details style={{ background: S2, borderRadius: 10, padding: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Per-pipeline breakdown ({ghlSummary.pipeline_breakdown.length} pipelines)
              </summary>
              <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                {ghlSummary.pipeline_breakdown.map((pb: any) => (
                  <div key={pb.pipeline_id} style={{ padding: "8px 0", borderBottom: "1px solid " + B1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{pb.pipeline_name}</span>
                      <span style={{ fontFamily: "'DM Mono', monospace", color: G }}>
                        {Number(pb.total).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: T3, marginTop: 3 }}>
                      {Object.entries(pb.by_stage || {})
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div style={{ fontSize: 11, color: T3, marginTop: 10 }}>
            Computed at {ghlSummary.computed_at ? new Date(ghlSummary.computed_at).toLocaleString() : "—"}.
            Period: {new Date().toLocaleString("default", { month: "long", year: "numeric" })}.
          </div>
        </div>
      )}

      {/* ─── Footer: sync status ─── */}
      <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid " + B1, fontSize: 12, color: T3 }}>
        Last sync: {org?.ghl_last_sync_at ? new Date(org.ghl_last_sync_at).toLocaleString() : "never"}
        {org?.ghl_last_sync_error && <div style={{ color: RED, marginTop: 4 }}>Last error: {org.ghl_last_sync_error}</div>}
      </div>
    </div>
  );
}
