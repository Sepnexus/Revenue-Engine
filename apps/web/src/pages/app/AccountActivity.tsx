import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/hooks/useActivityLog";
import { G, BG, S1, S2, B1, B2, TEXT, T2, T3 } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

const EVENT_LABELS: Record<string, string> = {
  kpi_saved: "KPI Period Saved",
  pdf_exported: "PDF Report Exported",
  csv_exported: "CSV Data Exported",
  login: "Login",
};

export default function AccountActivity() {
  const { orgId, signOut } = useAuth();
  const { events, isLoading } = useActivityLog(orgId);

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 30 }} />
          <Link to="/app/account" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Account</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Activity</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 700, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Recent Activity</div>
        {isLoading ? (
          <div style={{ color: T3, fontSize: 14 }}>Loading...</div>
        ) : events.length === 0 ? (
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 14, color: T3 }}>No activity recorded yet. Start by saving KPI data!</div>
          </div>
        ) : (
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, overflow: "hidden" }}>
            {events.map((ev: any) => (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: "1px solid " + B1 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: G, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{EVENT_LABELS[ev.event_type] || ev.event_type}</div>
                  {ev.metadata?.period && <div style={{ fontSize: 12, color: T3 }}>Period: {ev.metadata.period}</div>}
                </div>
                <div style={{ fontSize: 12, color: T3, fontFamily: "'DM Mono',monospace" }}>{new Date(ev.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
