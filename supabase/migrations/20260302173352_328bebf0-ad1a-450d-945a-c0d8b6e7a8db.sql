
-- Replace unrestricted service role insert policy on ai_usage_logs with validated constraints
DROP POLICY IF EXISTS "Service can insert ai_usage_logs" ON public.ai_usage_logs;

CREATE POLICY "Service can insert valid ai_usage_logs"
ON public.ai_usage_logs FOR INSERT
TO service_role
WITH CHECK (
  org_id IS NOT NULL
  AND user_id IS NOT NULL
  AND agent_key IN ('diagnosing', 'prioritization', 'simulation')
  AND prompt_tokens >= 0
  AND completion_tokens >= 0
  AND total_tokens >= 0
  AND cost_usd >= 0
);
