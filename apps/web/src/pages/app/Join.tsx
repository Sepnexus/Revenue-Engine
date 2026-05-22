import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { G, BG, S2, B2, TEXT, T2, T3 } from "@/shared/kpi";

export default function Join() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { data, error: fnError } = await supabase.functions.invoke("self-signup", {
      body: { email, password, fullName, companyName },
    });

    if (fnError || data?.error) {
      setError(data?.error || fnError?.message || "Something went wrong");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  const IS: React.CSSProperties = {
    background: S2,
    border: "1px solid " + B2,
    borderRadius: 9,
    padding: "12px 16px",
    color: TEXT,
    fontSize: 14,
    outline: "none",
    fontFamily: "'DM Sans',sans-serif",
    width: "100%",
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: TEXT }}>Revenue Engine</div>
          <div style={{ fontSize: 11, color: T3, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 4 }}>Create Your Account</div>
        </div>

        {success ? (
          <div style={{ textAlign: "center", color: G, fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <div style={{ marginBottom: 8 }}>Your account has been created successfully!</div>
            <Link to="/app/login" style={{ color: G, fontWeight: 700, textDecoration: "none" }}>
              Sign in now →
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="text" placeholder="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} style={IS} required />
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={IS} required />
            <input type="text" placeholder="Company Name" value={companyName} onChange={e => setCompanyName(e.target.value)} style={IS} required />
            <input type="password" placeholder="Password (min 6 characters)" value={password} onChange={e => setPassword(e.target.value)} style={IS} required minLength={6} />
            {error && <div style={{ color: "#f05050", fontSize: 12 }}>{error}</div>}
            <button
              type="submit"
              disabled={loading}
              style={{
                background: G,
                border: "none",
                borderRadius: 9,
                padding: "12px 16px",
                color: "#000",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Creating Account..." : "Get Started"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
