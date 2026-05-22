import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { trackedQuery } from "@/lib/query-utils";
import { friendlyErrorMessage } from "@/lib/query-utils";
import { InlineError, InlineLoading } from "@/components/QueryStates";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";

export default function AdminDashboard() {

  const { data: stats, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => trackedQuery("admin-stats", async () => {
      const [orgs, subs, kpiPeriods] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact" }),
        supabase.from("subscriptions").select("*"),
        supabase.from("kpi_periods").select("org_id, period_start, updated_at"),
      ]);
      const total = orgs.count || 0;
      const subList = subs.data || [];
      const active = subList.filter(s => s.plan_status === "active" || s.plan_status === "trial").length;
      const expired = subList.filter(s => s.plan_status === "expired" || s.plan_status === "suspended").length;

      const now = new Date();
      const in14 = new Date(now.getTime() + 14 * 86400000);
      const expiringSoon = subList.filter(s =>
        (s.plan_status === "active" || s.plan_status === "trial") &&
        s.expires_at && new Date(s.expires_at) <= in14 && new Date(s.expires_at) >= now
      ).length;

      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const kpiThisMonth = new Set((kpiPeriods.data || []).filter((k: any) => k.period_start === curMonth).map((k: any) => k.org_id));
      const noKpiThisMonth = total - kpiThisMonth.size;

      return { total, active, expired, expiringSoon, noKpiThisMonth };
    }),
  });

  const cards = [
    { label: "Total Organizations", value: stats?.total || 0, color: TEXT },
    { label: "Active Subscriptions", value: stats?.active || 0, color: G },
    { label: "Expired / Suspended", value: stats?.expired || 0, color: RED },
    { label: "Expiring in 14 Days", value: stats?.expiringSoon || 0, color: AMBER },
    { label: "No KPI This Month", value: stats?.noKpiThisMonth || 0, color: AMBER },
  ];

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Admin Overview</div>
        {isError && (
          <div style={{ marginBottom: 20 }}>
            <InlineError message={friendlyErrorMessage(error)} onRetry={() => refetch()} />
          </div>
        )}
        {isLoading && !stats ? (
          <InlineLoading message="Loading dashboard stats..." />
        ) : (
          <div className="admin-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
            {cards.map(c => (
              <div key={c.label} style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
                <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{c.label}</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: c.color, fontFamily: "'DM Mono',monospace" }}>{c.value}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
