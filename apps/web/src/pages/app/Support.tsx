import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, RED } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

export default function Support() {
  const { user, orgId, signOut } = useAuth();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!subject.trim() || !message.trim() || !orgId || !user) return;
    setSending(true);
    const { error } = await supabase.from("support_tickets" as any).insert({
      org_id: orgId,
      created_by: user.id,
      subject,
      message,
      category,
    } as any);
    setSending(false);
    if (error) {
      setMsg("Error submitting ticket");
    } else {
      setMsg("Ticket submitted ✓ We'll get back to you soon.");
      setSubject("");
      setMessage("");
      setCategory("general");
    }
    setTimeout(() => setMsg(""), 4000);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 30 }} />
          <Link to="/app/dashboard" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Dashboard</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Support</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 28px" }}>
        {msg && (
          <div style={{ background: msg.startsWith("Error") ? RED + "15" : G + "15", border: "1px solid " + (msg.startsWith("Error") ? RED : G) + "40", borderRadius: 8, padding: "10px 14px", color: msg.startsWith("Error") ? RED : G, fontSize: 13, marginBottom: 20 }}>{msg}</div>
        )}

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Submit a Ticket</div>
          <div style={{ fontSize: 13, color: T3, marginBottom: 20 }}>We typically respond within 24 hours.</div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Category</div>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...IS, cursor: "pointer" }}>
              <option value="billing">Billing</option>
              <option value="kpi_help">KPI Help</option>
              <option value="bug">Bug Report</option>
              <option value="general">General</option>
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Subject</div>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief description" style={IS} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Message</div>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe your issue or question..."
              rows={5} style={{ ...IS, resize: "vertical" }} />
          </div>

          <button onClick={submit} disabled={sending || !subject.trim() || !message.trim()}
            style={{ background: G, border: "none", borderRadius: 10, padding: "12px 24px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: sending ? 0.6 : 1 }}>
            {sending ? "Submitting..." : "Submit Ticket"}
          </button>
        </div>
      </main>
    </div>
  );
}
