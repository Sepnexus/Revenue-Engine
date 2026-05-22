import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { G, BG, S2, B2, TEXT, T3 } from "@/shared/kpi";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check for recovery token in URL hash
    const hash = window.location.hash;
    if (!hash.includes("type=recovery")) {
      // No recovery token, redirect
    }
  }, []);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    setSuccess(true); setLoading(false);
    setTimeout(() => navigate("/app/login"), 2000);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: TEXT }}>Set New Password</div>
        </div>
        {success ? (
          <div style={{ textAlign: "center", color: G, fontSize: 14 }}>Password updated! Redirecting...</div>
        ) : (
          <form onSubmit={handle} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="password" placeholder="New Password (min 6 characters)" value={password} onChange={e => setPassword(e.target.value)} style={IS} required minLength={6} />
            {error && <div style={{ color: "#f05050", fontSize: 12 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ background: G, border: "none", borderRadius: 9, padding: "12px 16px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
