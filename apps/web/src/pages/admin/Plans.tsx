import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";
import { useState } from "react";

const ENTITLEMENT_FLAGS = [
  { key: "ai_enabled", label: "AI Intelligence" },
  { key: "exports_enabled", label: "CSV Exports" },
  { key: "pdf_enabled", label: "PDF Reports" },
  { key: "team_enabled", label: "Sales Team" },
  { key: "financials_enabled", label: "Financial Statement" },
  { key: "history_enabled", label: "History Tab" },
] as const;

export default function AdminPlans() {
  const { user } = useAuth();
  const { log } = useAuditLog();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState("");
  const [newPlanName, setNewPlanName] = useState("");

  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plan_entitlements" as any).select("*").order("plan_name");
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const notify = (text: string) => { setMsg(text); setTimeout(() => setMsg(""), 2500); };

  const upsertPlan = useMutation({
    mutationFn: async (plan: any) => {
      const { error } = await supabase.from("plan_entitlements" as any).upsert(plan, { onConflict: "plan_name" });
      if (error) throw error;
      await log({ action: "upsert_plan", entity_type: "plan_entitlements", after_data: plan });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-plans"] }); notify("Plan saved ✓"); },
    onError: (e: any) => notify("Error: " + e.message),
  });

  const deletePlan = useMutation({
    mutationFn: async (planName: string) => {
      const { error } = await supabase.from("plan_entitlements" as any).delete().eq("plan_name", planName);
      if (error) throw error;
      await log({ action: "delete_plan", entity_type: "plan_entitlements", before_data: { plan_name: planName } });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-plans"] }); notify("Plan deleted ✓"); },
    onError: (e: any) => notify("Error: " + e.message),
  });

  const createPlan = () => {
    if (!newPlanName.trim()) return;
    upsertPlan.mutate({
      plan_name: newPlanName.trim(),
      ai_enabled: true, exports_enabled: true, pdf_enabled: true,
      team_enabled: true, financials_enabled: true, history_enabled: true,
      months_editable: 1,
    });
    setNewPlanName("");
  };

  const toggleFlag = (plan: any, key: string) => {
    upsertPlan.mutate({ ...plan, [key]: !plan[key] });
  };

  const updateMonths = (plan: any, val: string) => {
    upsertPlan.mutate({ ...plan, months_editable: val === "" ? 1 : Number(val) });
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "10px 14px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Plan Management</div>
        <div style={{ fontSize: 13, color: T3, marginBottom: 24 }}>Create and manage subscription plans. Each plan controls which features are available to assigned clients.</div>

        {msg && <div style={{ background: msg.startsWith("Error") ? RED + "15" : G + "15", border: "1px solid " + (msg.startsWith("Error") ? RED : G) + "40", borderRadius: 8, padding: "10px 14px", color: msg.startsWith("Error") ? RED : G, fontSize: 14, marginBottom: 16 }}>{msg}</div>}

        {/* Create new plan */}
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "20px 24px", marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Create New Plan</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={newPlanName} onChange={e => setNewPlanName(e.target.value)} placeholder="Plan name (e.g. Lite, Premium, Enterprise)" style={{ ...IS, flex: 1 }} onKeyDown={e => e.key === "Enter" && createPlan()} />
            <button onClick={createPlan} disabled={!newPlanName.trim()} style={{ background: G, border: "none", borderRadius: 8, padding: "0 24px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: !newPlanName.trim() ? 0.5 : 1 }}>Create Plan</button>
          </div>
        </div>

        {/* Plans list */}
        {isLoading ? (
          <div style={{ textAlign: "center", color: T3, padding: 40 }}>Loading plans...</div>
        ) : !plans || plans.length === 0 ? (
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 6 }}>No plans configured</div>
            <div style={{ fontSize: 13, color: T3 }}>Clients without a matching plan get all features enabled by default (Premium).</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {plans.map((plan: any) => (
              <div key={plan.plan_name} style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: G }}>{plan.plan_name}</div>
                  <button onClick={() => { if (confirm(`Delete plan "${plan.plan_name}"?`)) deletePlan.mutate(plan.plan_name); }} style={{ background: RED + "12", border: "1px solid " + RED + "30", borderRadius: 7, padding: "6px 14px", color: RED, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Delete Plan</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
                  {ENTITLEMENT_FLAGS.map(({ key, label }) => (
                    <button key={key} onClick={() => toggleFlag(plan, key)} style={{
                      background: plan[key] ? G + "12" : RED + "08",
                      border: "1px solid " + (plan[key] ? G + "30" : RED + "20"),
                      borderRadius: 10,
                      padding: "12px 16px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: plan[key] ? G : RED }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: plan[key] ? G : RED }}>{plan[key] ? "✓ ON" : "✕ OFF"}</span>
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: T3, textTransform: "uppercase", letterSpacing: .5 }}>Months Editable:</span>
                  <input type="number" min={0} value={plan.months_editable ?? 1} onChange={e => updateMonths(plan, e.target.value)} style={{ ...IS, width: 80, textAlign: "center" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info box */}
        <div style={{ marginTop: 24, background: S1, border: "1px solid " + B1, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: AMBER, marginBottom: 6 }}>💡 How Plans Work</div>
          <div style={{ fontSize: 13, color: T2, lineHeight: 1.7 }}>
            • Clients are assigned a plan via their subscription's <strong style={{ color: TEXT }}>plan_name</strong> field in Client Detail.<br/>
            • If no matching plan exists in this table, clients get <strong style={{ color: G }}>all features enabled</strong> (Premium by default).<br/>
            • To create a Lite/Free plan, create a plan here and toggle off premium features.<br/>
            • Changes take effect immediately for all clients on that plan.
          </div>
        </div>
      </main>
    </div>
  );
}
