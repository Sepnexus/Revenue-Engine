import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_AGENTS = new Set(["diagnosing", "prioritization", "simulation"]);

const AGENTS: Record<string, { sys: string }> = {
  diagnosing: { sys: "You are the Diagnosing AI inside Revenue Engine by Closer Control — a KPI platform for direct-to-seller real estate wholesalers.\n\nIMPORTANT CONTEXT: Most clients have NEVER tracked conversion KPIs before. Always explain what each metric means before advising. Be direct and specific. Sound like the most experienced wholesaling consultant in the country.\n\nBENCHMARKS:\n- Marketing ROI: 3x-5x is normal, 5x-8x is target, under 3x is a problem\n- Contract-to-Close: 40-55% is industry average\n- Lead-to-Net: healthy is 60-75%, below 50% means list quality issues\n- Net Lead-to-Offer: healthy is 30-50%, below 25% means reps not pitching enough\n- Offer-to-Contract: healthy is 25-40%, below 20% means negotiation issues\n\nFORMAT: Bullet points max 5, always tie advice to specific numbers, end with one actionable next step." },
  prioritization: { sys: "You are the Prioritization AI inside Revenue Engine by Closer Control.\n\nYour job: look at all KPIs and tell the client exactly what to prioritize ranked by revenue impact. Be decisive. Always give a clear #1, #2, #3 with dollar reasoning.\n\nFRAMEWORK:\n1. REVENUE CONSTRAINT\n2. EFFICIENCY LEAK\n3. QUICK WIN\n4. SCALE LEVER\n\nFORMAT: Lead with biggest constraint in one sentence. Rank #1 #2 #3. End with what to do TODAY." },
  simulation: { sys: "You are the Simulation AI inside Revenue Engine by Closer Control.\n\nYour job: run financial what-if simulations using the client's ACTUAL numbers. Show before vs after clearly.\n\nSIMULATION STEPS:\n1. State current baseline\n2. Apply proposed change\n3. Calculate downstream funnel impact\n4. Show projected revenue impact in dollars\n5. State what it would realistically take\n\nFORMAT: Current State then Simulated State then Revenue Impact. Show every math step." },
};

// GPT-4o pricing per 1K tokens (as of 2024)
const PRICING = {
  "gpt-4o": { prompt: 0.0025, completion: 0.01 },
};

// --- Input validation helpers ---
function validateMessages(messages: unknown): { role: string; content: string }[] {
  if (!Array.isArray(messages)) throw new Error("invalid_input");
  if (messages.length > 50) throw new Error("invalid_input");
  return messages.map((m: any) => {
    if (!m || typeof m !== "object") throw new Error("invalid_input");
    if (!["user", "assistant"].includes(m.role)) throw new Error("invalid_input");
    if (typeof m.content !== "string" || m.content.length > 5000) throw new Error("invalid_input");
    return { role: m.role as string, content: m.content as string };
  });
}

function validateNumber(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function validateKpiData(d: unknown): Record<string, any> {
  if (!d || typeof d !== "object") throw new Error("invalid_input");
  const obj = d as Record<string, any>;
  const numericFields = [
    "m1Spend","m2Spend","m3Spend","m1NewLeads","m2NewLeads","m3NewLeads",
    "m1NetLeads","m2NetLeads","m3NetLeads","m1Offers","m2Offers","m3Offers",
    "m1Contracts","m2Contracts","m3Contracts","m1ClosedRevenue","m2ClosedRevenue","m3ClosedRevenue",
    "m1ClosedDeals","m2ClosedDeals","m3ClosedDeals",
    "acqCommission","dispoCommission","baseSalaries","systemsSoftware","propertyExp",
  ];
  const stringFields = ["m1Name","m2Name","m3Name"];
  const safe: Record<string, any> = {};
  for (const f of numericFields) safe[f] = validateNumber(obj[f]);
  for (const f of stringFields) safe[f] = typeof obj[f] === "string" ? obj[f].slice(0, 100) : "";
  return safe;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 102400) {
      return new Response(JSON.stringify({ error: "Request too large" }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { agentKey, period, conversationId, historicalContext } = body;

    if (!agentKey || !VALID_AGENTS.has(agentKey)) {
      return new Response(JSON.stringify({ error: "Invalid agent" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const messages = validateMessages(body.messages);
    const d = validateKpiData(body.kpiData);
    const safePeriod = typeof period === "string" ? period.slice(0, 50) : "Current";

    // --- Entitlement & rate-limit checks (server-side) ---
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();

    const orgId = profile?.org_id;

    // Check if user is a super_admin (bypass entitlement/rate-limit checks)
    const { data: roleRow } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "super_admin")
      .maybeSingle();

    const isSuperAdmin = !!roleRow;

    if (!orgId && !isSuperAdmin) {
      return new Response(JSON.stringify({ error: "No organization found" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Entitlement & rate-limit checks only for non-admin users
    if (!isSuperAdmin && orgId) {
      const { data: sub } = await serviceClient
        .from("subscriptions")
        .select("plan_name, plan_status, expires_at")
        .eq("org_id", orgId)
        .maybeSingle();

      if (!sub || !["active", "trial"].includes(sub.plan_status) || (sub.expires_at && new Date(sub.expires_at) < new Date())) {
        return new Response(JSON.stringify({ error: "Your subscription is not active" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: entitlements } = await serviceClient
        .from("plan_entitlements")
        .select("ai_enabled")
        .eq("plan_name", sub.plan_name)
        .maybeSingle();

      if (!entitlements?.ai_enabled) {
        return new Response(JSON.stringify({ error: "AI features are not available on your plan" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Daily rate limit per org (100 requests/day)
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const { count: dailyCount } = await serviceClient
        .from("ai_usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("created_at", dayAgo);

      if (dailyCount && dailyCount >= 100) {
        return new Response(JSON.stringify({ error: "Daily AI request limit reached. Please try again tomorrow." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const agent = AGENTS[agentKey];

    // Build context from validated KPI data
    const fmt$ = (v: number) => "$" + Math.round(v).toLocaleString();
    const fmtPct = (v: number) => Number(v).toFixed(1) + "%";
    const fmtRx = (v: number) => Number(v).toFixed(2) + "x";
    const sv = (n: number, dn: number) => dn === 0 ? 0 : n / dn;

    const ts = d.m1Spend + d.m2Spend + d.m3Spend;
    const tnl = d.m1NewLeads + d.m2NewLeads + d.m3NewLeads;
    const tnet = d.m1NetLeads + d.m2NetLeads + d.m3NetLeads;
    const toff = d.m1Offers + d.m2Offers + d.m3Offers;
    const tcon = d.m1Contracts + d.m2Contracts + d.m3Contracts;
    const rev = d.m1ClosedRevenue + d.m2ClosedRevenue + d.m3ClosedRevenue;
    const deals = d.m1ClosedDeals + d.m2ClosedDeals + d.m3ClosedDeals;
    const exp = ts + d.acqCommission + d.dispoCommission + d.baseSalaries + d.systemsSoftware + d.propertyExp;
    const profit = rev - exp;
    const mROI = sv(rev, ts);
    const bROI = sv(rev, exp);
    const margin = sv(profit, rev) * 100;

    const chCalc = (sp: number, nl: number, _net: number, _off: number, _con: number, r: number, dl: number) => ({
      roi: sv(r, sp), cpl: sv(sp, nl), c2cl: sv(dl, _con) * 100,
    });
    const m1 = chCalc(d.m1Spend, d.m1NewLeads, d.m1NetLeads, d.m1Offers, d.m1Contracts, d.m1ClosedRevenue, d.m1ClosedDeals);
    const m2 = chCalc(d.m2Spend, d.m2NewLeads, d.m2NetLeads, d.m2Offers, d.m2Contracts, d.m2ClosedRevenue, d.m2ClosedDeals);
    const m3 = chCalc(d.m3Spend, d.m3NewLeads, d.m3NetLeads, d.m3Offers, d.m3Contracts, d.m3ClosedRevenue, d.m3ClosedDeals);

    const context = [
      "PERIOD: " + safePeriod,
      "Gross Revenue: " + fmt$(rev) + " | Gross Profit: " + fmt$(profit) + " | Margin: " + fmtPct(margin),
      "Marketing ROI: " + fmtRx(mROI) + " | Business ROI: " + fmtRx(bROI) + " | Total Spend: " + fmt$(ts),
      "Leads: " + tnl + " | Net: " + tnet + " | Offers: " + toff + " | Contracts: " + tcon + " | Deals: " + deals,
      d.m1Name + ": spend " + fmt$(d.m1Spend) + " leads " + d.m1NewLeads + " deals " + d.m1ClosedDeals + " rev " + fmt$(d.m1ClosedRevenue) + " ROI " + fmtRx(m1.roi),
      d.m2Name + ": spend " + fmt$(d.m2Spend) + " leads " + d.m2NewLeads + " deals " + d.m2ClosedDeals + " rev " + fmt$(d.m2ClosedRevenue) + " ROI " + fmtRx(m2.roi),
      d.m3Name + ": spend " + fmt$(d.m3Spend) + " leads " + d.m3NewLeads + " deals " + d.m3ClosedDeals + " rev " + fmt$(d.m3ClosedRevenue) + " ROI " + fmtRx(m3.roi),
    ].join("\n");

    // Append historical context if provided
    const safeHistorical = typeof historicalContext === "string" && historicalContext.length > 0 && historicalContext.length < 2000 ? "\n\nHISTORICAL CONTEXT:\n" + historicalContext : "";

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("config_missing");

    const model = "gpt-4o";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: agent.sys + "\n\nCLIENT DATA:\n" + context + safeHistorical },
          ...messages,
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("ai_gateway_error");
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Unable to get response.";
    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || 0;

    // Calculate cost
    const pricing = PRICING[model as keyof typeof PRICING] || { prompt: 0, completion: 0 };
    const costUsd = (promptTokens / 1000) * pricing.prompt + (completionTokens / 1000) * pricing.completion;

    // Persist conversation and usage data (serviceClient + orgId already available from entitlement check)
    {
      // Get or create conversation
      let convId = conversationId;
      if (!convId) {
        const { data: conv } = await serviceClient
          .from("chat_conversations")
          .insert({ org_id: orgId, user_id: user.id, agent_key: agentKey, period: safePeriod })
          .select("id")
          .single();
        convId = conv?.id;
      }

      if (convId) {
        // Save the latest user message and assistant reply
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg) {
          await serviceClient.from("chat_messages").insert([
            { conversation_id: convId, org_id: orgId, role: "user", content: lastUserMsg.content },
            { conversation_id: convId, org_id: orgId, role: "assistant", content: reply },
          ]);
        }

        // Log AI usage
        await serviceClient.from("ai_usage_logs").insert({
          org_id: orgId,
          user_id: user.id,
          conversation_id: convId,
          agent_key: agentKey,
          model,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cost_usd: costUsd,
        });
      }

      return new Response(JSON.stringify({
        reply,
        conversationId: convId,
        usage: { promptTokens, completionTokens, totalTokens, costUsd },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
