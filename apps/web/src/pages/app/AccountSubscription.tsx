import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useEntitlements } from "@/hooks/useEntitlements";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, RED, AMBER } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

export default function AccountSubscription() {
  const { orgId, signOut } = useAuth();
  const sub = useSubscription(orgId);
  const ent = useEntitlements(orgId);

  const daysLeft = sub.data?.expiresAt
    ? Math.ceil((new Date(sub.data.expiresAt).getTime() - Date.now()) / 86400000)
    : null;

  const statusColor = sub.data?.isActive ? G : RED;
  const isInactive = sub.data && !sub.data.isActive;

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 30 }} />
          <Link to="/app/account" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Account</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Subscription</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 28px" }}>
        {isInactive && (
          <div style={{ background: RED + "12", border: "1px solid " + RED + "30", borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: RED, marginBottom: 6 }}>
              {sub.data?.isSuspended ? "Account Suspended" : "Subscription Expired"}
            </div>
            <div style={{ fontSize: 14, color: T2, marginBottom: 12 }}>Your data is read-only. Contact support to renew your subscription.</div>
            <Link to="/app/support" style={{ display: "inline-block", background: RED, borderRadius: 8, padding: "10px 20px", color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>Contact Support to Renew</Link>
          </div>
        )}

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Plan Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 6 }}>Plan</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{sub.data?.planName || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 6 }}>Status</div>
              <span style={{ fontSize: 14, fontWeight: 700, color: statusColor, background: statusColor + "15", border: "1px solid " + statusColor + "30", borderRadius: 6, padding: "4px 12px" }}>{sub.data?.status || "—"}</span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 6 }}>Expires</div>
              <div style={{ fontSize: 14, color: T2 }}>{sub.data?.expiresAt ? new Date(sub.data.expiresAt).toLocaleDateString() : "No expiry"}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 6 }}>Days Remaining</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: daysLeft !== null && daysLeft <= 14 ? (daysLeft <= 0 ? RED : AMBER) : G }}>
                {daysLeft !== null ? (daysLeft <= 0 ? "Expired" : `${daysLeft} days`) : "∞"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>What's Included</div>
          {ent.data ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "AI Intelligence Layer", enabled: ent.data.ai_enabled },
                { label: "CSV Data Exports", enabled: ent.data.exports_enabled },
                { label: "PDF Reports", enabled: ent.data.pdf_enabled },
                { label: "Real-Time KPI Dashboard", enabled: true },
                { label: "Red Zone Monitor", enabled: true },
                { label: "Channel Analytics", enabled: true },
              ].map(item => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, color: item.enabled ? G : RED }}>{item.enabled ? "✓" : "✗"}</span>
                  <span style={{ fontSize: 14, color: item.enabled ? TEXT : T3 }}>{item.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: T3 }}>Loading entitlements...</div>
          )}
        </div>
      </main>
    </div>
  );
}
