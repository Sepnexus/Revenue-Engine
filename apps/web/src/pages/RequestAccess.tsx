import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { G, BG, S1, S2, B1, B2, TEXT, T2, T3 } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

export default function RequestAccess() {
  const [form, setForm] = useState({ full_name: "", email: "", company_name: "", phone: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim() || !form.company_name.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    setError("");
    setLoading(true);
    const { error: dbError } = await supabase.from("access_requests").insert({
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      company_name: form.company_name.trim(),
      phone: form.phone.trim() || null,
      message: form.message.trim() || null,
    });
    setLoading(false);
    if (dbError) {
      setError("Something went wrong. Please try again.");
      console.error("Access request error:", dbError);
      return;
    }
    setSubmitted(true);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');`}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 40px", borderBottom: "1px solid " + B1 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 36 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>Revenue Engine</div>
            <div style={{ fontSize: 10, color: T3, letterSpacing: 1.4, textTransform: "uppercase" }}>by Closer Control</div>
          </div>
        </Link>
        <Link to="/" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Back to Home</Link>
      </header>

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 480 }}>
          {submitted ? (
            <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 18, padding: "48px 36px", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: G, marginBottom: 10 }}>Request Submitted!</div>
              <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, marginBottom: 24 }}>
                Thank you for your interest. Our team will review your request and get back to you shortly.
              </div>
              <Link to="/" style={{ background: G, border: "none", borderRadius: 9, padding: "10px 24px", color: "#000", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>Back to Home</Link>
            </div>
          ) : (
            <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 18, padding: "36px 32px" }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, marginBottom: 6 }}>Request Access</div>
                <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.6 }}>
                  Revenue Engine is invite-only. Fill out the form below and our team will set up your account.
                </div>
              </div>
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, color: TEXT, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, display: "block" }}>Full Name *</label>
                  <input type="text" value={form.full_name} onChange={set("full_name")} placeholder="John Doe" style={IS} required maxLength={100} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: TEXT, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, display: "block" }}>Email *</label>
                  <input type="email" value={form.email} onChange={set("email")} placeholder="john@company.com" style={IS} required maxLength={255} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: TEXT, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, display: "block" }}>Company Name *</label>
                  <input type="text" value={form.company_name} onChange={set("company_name")} placeholder="Apex Wholesale Group" style={IS} required maxLength={100} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: TEXT, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, display: "block" }}>Phone (optional)</label>
                  <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+1 (555) 123-4567" style={IS} maxLength={20} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: TEXT, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, display: "block" }}>Message (optional)</label>
                  <textarea value={form.message} onChange={set("message")} placeholder="Tell us about your wholesaling business..." rows={3} style={{ ...IS, resize: "vertical" }} maxLength={1000} />
                </div>
                {error && <div style={{ color: "#f05050", fontSize: 12 }}>{error}</div>}
                <button type="submit" disabled={loading} style={{ background: G, border: "none", borderRadius: 9, padding: "12px 16px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1, marginTop: 4 }}>
                  {loading ? "Submitting..." : "Submit Request"}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
