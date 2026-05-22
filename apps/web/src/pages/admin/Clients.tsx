import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuditLog } from "@/hooks/useAuditLog";
import { trackedQuery, friendlyErrorMessage } from "@/lib/query-utils";
import { InlineError, InlineLoading } from "@/components/QueryStates";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";
import { useState } from "react";
export default function AdminClients() {
  const { user } = useAuth();
  const { log } = useAuditLog();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: clients, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: () => trackedQuery("admin-clients", async () => {
      const { data: orgs } = await supabase.from("organizations").select("*, subscriptions(*)").order("created_at", { ascending: false });
      const { data: kpiData } = await supabase.from("kpi_periods").select("org_id, period_start, updated_at").order("updated_at", { ascending: false });
      const kpiMap: Record<string, { lastUpdate: string; currentSaved: boolean }> = {};
      const now = new Date();
      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      (kpiData || []).forEach((k: any) => {
        if (!kpiMap[k.org_id]) {
          kpiMap[k.org_id] = { lastUpdate: k.updated_at, currentSaved: false };
        }
        if (k.period_start === curMonth) kpiMap[k.org_id].currentSaved = true;
      });

      const { data: billingData } = await supabase.from("billing_records" as any).select("org_id, amount_paid, paid_at").order("paid_at", { ascending: false });
      const billingMap: Record<string, { total: number; lastDate: string | null }> = {};
      ((billingData as any[]) || []).forEach((b: any) => {
        if (!billingMap[b.org_id]) billingMap[b.org_id] = { total: 0, lastDate: b.paid_at };
        billingMap[b.org_id].total += Number(b.amount_paid);
      });

      return (orgs || []).map((o: any) => ({ ...o, kpiInfo: kpiMap[o.id] || null, billing: billingMap[o.id] || null }));
    }),
  });

  const quickAction = useMutation({
    mutationFn: async ({ orgId, action, sub }: { orgId: string; action: string; sub: any }) => {
      const now = new Date();
      let updates: any = { updated_by: user?.id };
      let eventType = action;
      const prevStatus = sub?.plan_status;
      const prevExpiry = sub?.expires_at;

      if (action === "extend_30" || action === "extend_90") {
        const days = action === "extend_30" ? 30 : 90;
        const base = sub?.expires_at ? new Date(sub.expires_at) : now;
        base.setDate(base.getDate() + days);
        updates.expires_at = base.toISOString();
        updates.plan_status = "active";
        eventType = "extend_expiry";
      } else if (action === "suspend") {
        updates.plan_status = "suspended";
        eventType = "suspend_subscription";
      } else if (action === "activate") {
        updates.plan_status = "active";
        eventType = "activate_subscription";
      }

      await supabase.from("subscriptions").update(updates).eq("org_id", orgId);

      // Log subscription event
      await supabase.from("subscription_events").insert({
        org_id: orgId,
        changed_by: user?.id,
        event_type: eventType,
        previous_status: prevStatus,
        new_status: updates.plan_status || prevStatus,
        previous_expiry: prevExpiry,
        new_expiry: updates.expires_at || prevExpiry,
      } as any);

      // Audit log
      await log({
        action: eventType,
        entity_type: "subscription",
        org_id: orgId,
        before_data: { plan_status: prevStatus, expires_at: prevExpiry },
        after_data: updates,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
  });

  const filtered = clients?.filter((c: any) => c.name.toLowerCase().includes(search.toLowerCase())) || [];

  const daysUntil = (date: string | null) => {
    if (!date) return null;
    const diff = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
    return diff;
  };

  const statusBadge = (sub: any) => {
    if (!sub) return { color: T3, label: "none" };
    const days = daysUntil(sub.expires_at);
    if (sub.plan_status === "suspended") return { color: RED, label: "suspended" };
    if (sub.plan_status === "expired" || (days !== null && days < 0)) return { color: RED, label: "expired" };
    if (days !== null && days <= 14) return { color: AMBER, label: `${days}d left` };
    if (sub.plan_status === "active" || sub.plan_status === "trial") return { color: G, label: sub.plan_status };
    return { color: T3, label: sub.plan_status };
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />
      <main style={{ maxWidth: 1300, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Client Organizations</div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..." style={{ background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "9px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "inherit", width: 280 }} />
        </div>
        {isError && (
          <div style={{ marginBottom: 16 }}>
            <InlineError message={friendlyErrorMessage(error)} onRetry={() => refetch()} />
          </div>
        )}
        {isLoading && !clients ? (
          <InlineLoading message="Loading clients..." />
        ) : (
        <div className="admin-table-wrap" style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Organization", "Status", "Expires", "Last KPI", "This Month", "LTV", "Last Pay", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "14px 16px", fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .6, borderBottom: "1px solid " + B1, fontWeight: 500 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map((org: any) => {
                const sub = Array.isArray(org.subscriptions) ? org.subscriptions[0] : org.subscriptions;
                const badge = statusBadge(sub);
                const kpi = org.kpiInfo;
                return (
                  <tr key={org.id} style={{ borderBottom: "1px solid " + B1 }}>
                    <td style={{ padding: "14px 16px", fontSize: 15, fontWeight: 600, color: TEXT }}>{org.name}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: badge.color, background: badge.color + "12", border: "1px solid " + badge.color + "30", borderRadius: 5, padding: "3px 10px" }}>{badge.label}</span>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 14, color: T3 }}>{sub?.expires_at ? new Date(sub.expires_at).toLocaleDateString() : "—"}</td>
                    <td style={{ padding: "14px 16px", fontSize: 13, color: T3 }}>{kpi?.lastUpdate ? new Date(kpi.lastUpdate).toLocaleDateString() : "—"}</td>
                    <td style={{ padding: "14px 16px" }}>
                      {kpi?.currentSaved
                        ? <span style={{ fontSize: 12, color: G }}>✓ Saved</span>
                        : <span style={{ fontSize: 12, color: AMBER }}>✗ Missing</span>
                      }
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      {org.billing
                        ? <span style={{ fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>${org.billing.total.toLocaleString()}</span>
                        : <span style={{ fontSize: 12, color: T3 }}>—</span>
                      }
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 12, color: T3 }}>{org.billing?.lastDate ? new Date(org.billing.lastDate).toLocaleDateString() : "—"}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Link to={`/admin/clients/${org.id}`} style={{ background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "5px 10px", color: T2, fontSize: 11, textDecoration: "none" }}>Details</Link>
                        <Link to={`/admin/clients/${org.id}/revenue-engine`} style={{ background: G + "15", border: "1px solid " + G + "30", borderRadius: 7, padding: "5px 10px", color: G, fontSize: 11, textDecoration: "none" }}>Dashboard</Link>
                        <button onClick={() => quickAction.mutate({ orgId: org.id, action: "extend_30", sub })} style={{ background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "5px 10px", color: T2, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+30d</button>
                        <button onClick={() => quickAction.mutate({ orgId: org.id, action: "extend_90", sub })} style={{ background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "5px 10px", color: T2, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+90d</button>
                        {sub?.plan_status !== "suspended" ? (
                          <button onClick={() => quickAction.mutate({ orgId: org.id, action: "suspend", sub })} style={{ background: RED + "12", border: "1px solid " + RED + "30", borderRadius: 7, padding: "5px 10px", color: RED, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Suspend</button>
                        ) : (
                          <button onClick={() => quickAction.mutate({ orgId: org.id, action: "activate", sub })} style={{ background: G + "12", border: "1px solid " + G + "30", borderRadius: 7, padding: "5px 10px", color: G, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Activate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "30px 16px", textAlign: "center", color: T3, fontSize: 14 }}>No clients found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </main>
    </div>
  );
}
