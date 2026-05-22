import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { G, BG, S1, S2, B1, B2, TEXT, T2, T3 } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

const cards = [
  { title: "Profile", desc: "Company details, contact info, timezone", path: "/app/account/profile", icon: "👤" },
  { title: "Subscription", desc: "Plan status, expiry, entitlements", path: "/app/account/subscription", icon: "📋" },
  { title: "Activity", desc: "Recent actions and events", path: "/app/account/activity", icon: "📊" },
  { title: "Exports", desc: "Download KPI data as CSV", path: "/app/account/exports", icon: "📥" },
  { title: "Support", desc: "Submit a support ticket", path: "/app/support", icon: "💬" },
];

export default function Account() {
  const { signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header className="admin-header" style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 30 }} />
          <Link to="/app/dashboard" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Dashboard</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Account</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Your Account</div>
        <div style={{ fontSize: 14, color: T3, marginBottom: 32 }}>Manage your profile, subscription, and data</div>
        <div className="account-cards" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
          {cards.map(c => (
            <Link key={c.path} to={c.path} style={{ textDecoration: "none" }}>
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", cursor: "pointer", transition: "border-color .15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = G + "40")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = B1)}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{c.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 6 }}>{c.title}</div>
                <div style={{ fontSize: 13, color: T3 }}>{c.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
