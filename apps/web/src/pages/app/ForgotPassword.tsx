import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { G, BG, S2, B2, TEXT, T2, T3 } from "@/shared/kpi";

export default function ForgotPassword({ admin }: { admin?: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/app/reset-password",
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setSent(true); setLoading(false);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: TEXT }}>Reset Password</div>
        </div>
        {sent ? (
          <div style={{ textAlign: "center", color: G, fontSize: 14 }}>Check your email for a reset link.</div>
        ) : (
          <form onSubmit={handle} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={IS} required />
            {error && <div style={{ color: "#f05050", fontSize: 12 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ background: G, border: "none", borderRadius: 9, padding: "12px 16px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>
        )}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Link to={admin ? "/admin/login" : "/app/login"} style={{ color: T2, fontSize: 12, textDecoration: "none" }}>← Back to login</Link>
        </div>
      </div>
    </div>
  );
}
