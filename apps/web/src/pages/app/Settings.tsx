import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3 } from "@/shared/kpi";
import { Link } from "react-router-dom";

export default function Settings() {
  const { user, orgId, signOut } = useAuth();
  const sub = useSubscription(orgId);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const updateProfile = async () => {
    if (!fullName.trim()) return;
    setLoading(true);
    await supabase.from("profiles").update({ full_name: fullName }).eq("id", user?.id);
    setMsg("Profile updated"); setLoading(false);
    setTimeout(() => setMsg(""), 2000);
  };

  const updatePassword = async () => {
    if (!password || password.length < 6) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setMsg(error ? error.message : "Password updated");
    setLoading(false); setPassword("");
    setTimeout(() => setMsg(""), 3000);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to="/app/dashboard" style={{ color: T2, fontSize: 12, textDecoration: "none" }}>← Dashboard</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Settings</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 28px" }}>
        {msg && <div style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "10px 14px", color: G, fontSize: 13, marginBottom: 20 }}>{msg}</div>}

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Profile</div>
          <div style={{ fontSize: 12, color: T3, marginBottom: 4 }}>Email</div>
          <div style={{ fontSize: 14, color: T2, marginBottom: 16 }}>{user?.email}</div>
          <div style={{ fontSize: 12, color: T3, marginBottom: 4 }}>Full Name</div>
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Enter full name" style={{ ...IS, marginBottom: 12 }} />
          <button onClick={updateProfile} disabled={loading} style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "8px 16px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Update Profile</button>
        </div>

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Change Password</div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (min 6 chars)" style={{ ...IS, marginBottom: 12 }} />
          <button onClick={updatePassword} disabled={loading} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "8px 16px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Change Password</button>
        </div>

        {sub.data && (
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Subscription</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><div style={{ fontSize: 10, color: T3, textTransform: "uppercase", marginBottom: 4 }}>Plan</div><div style={{ fontSize: 14, color: TEXT }}>{sub.data.planName}</div></div>
              <div><div style={{ fontSize: 10, color: T3, textTransform: "uppercase", marginBottom: 4 }}>Status</div><div style={{ fontSize: 14, color: sub.data.isActive ? G : "#f05050" }}>{sub.data.status}</div></div>
              <div><div style={{ fontSize: 10, color: T3, textTransform: "uppercase", marginBottom: 4 }}>Expires</div><div style={{ fontSize: 14, color: T2 }}>{sub.data.expiresAt ? new Date(sub.data.expiresAt).toLocaleDateString() : "No expiry"}</div></div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
