import { Link } from "react-router-dom";
import { BG, TEXT, T3, B1 } from "@/shared/kpi";

export default function Privacy() {
  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", padding: "60px 40px", maxWidth: 700, margin: "0 auto" }}>
      <Link to="/" style={{ color: T3, fontSize: 12, textDecoration: "none", marginBottom: 20, display: "block" }}>← Back</Link>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: TEXT, marginBottom: 20 }}>Privacy Policy</h1>
      <div style={{ color: T3, fontSize: 14, lineHeight: 1.8, borderTop: "1px solid " + B1, paddingTop: 20 }}>
        <p>This privacy policy is a placeholder. Revenue Engine by Closer Control respects your privacy. We collect only the data necessary to provide the KPI tracking service.</p>
        <p style={{ marginTop: 16 }}>Contact us at support@closercontrol.com for questions about your data.</p>
      </div>
    </div>
  );
}
