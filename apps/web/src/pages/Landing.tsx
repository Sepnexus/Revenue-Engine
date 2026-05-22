import { Link } from "react-router-dom";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3 } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

export default function Landing() {
  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Mono:wght@400;500;600&display=swap');`}</style>
      
      <header className="landing-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 40px", borderBottom: "1px solid " + B1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 36 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>Revenue Engine</div>
            <div style={{ fontSize: 10, color: T3, letterSpacing: 1.4, textTransform: "uppercase" }}>by Closer Control</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/app/login" style={{ background: G, border: "none", borderRadius: 9, padding: "10px 24px", color: "#000", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>Client Login</Link>
          <Link to="/admin/login" style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 9, padding: "10px 24px", color: T2, fontWeight: 500, fontSize: 14, textDecoration: "none" }}>Admin Login</Link>
        </div>
      </header>

      <main className="landing-hero" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 40px", textAlign: "center" }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: G, background: G + "12", border: "1px solid " + G + "30", borderRadius: 20, padding: "6px 16px", letterSpacing: 0.8, textTransform: "uppercase" }}>KPI Intelligence Platform</span>
        </div>
        <h1 style={{ fontSize: 56, fontWeight: 800, color: TEXT, lineHeight: 1.1, maxWidth: 700, marginBottom: 20 }}>
          Know Your Numbers.<br />
          <span style={{ color: G }}>Scale Your Marketing.</span>
        </h1>
        <p style={{ fontSize: 17, color: "#c4cac4", maxWidth: 540, lineHeight: 1.7, marginBottom: 40 }}>
          Revenue Engine tracks every KPI that matters in wholesale real estate — from lead-to-close conversions to channel ROI — so you can make decisions backed by data, not guesses.
        </p>
        <div className="landing-hero-buttons" style={{ display: "flex", gap: 16 }}>
          <Link to="/request-access" style={{ background: G, border: "none", borderRadius: 12, padding: "14px 32px", color: "#000", fontWeight: 700, fontSize: 15, textDecoration: "none" }}>Get Started →</Link>
          <Link to="/app/login" style={{ background: S2, border: "1px solid " + B2, borderRadius: 12, padding: "14px 32px", color: TEXT, fontWeight: 500, fontSize: 15, textDecoration: "none" }}>Sign In</Link>
        </div>

        <div className="landing-features" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 80, maxWidth: 900, width: "100%" }}>
          {[
            {
              title: "Real-Time KPI Dashboard",
              desc: "Track revenue, profit, conversions, and ROI across all marketing channels in one unified view. Every metric updates instantly as you enter your data.",
              accent: G,
            },
            {
              title: "AI Intelligence Layer",
              desc: "Three specialized AI agents — Diagnose, Prioritize, and Simulate — analyze your numbers and give you actionable insights specific to your business.",
              accent: "#f0a830",
            },
            {
              title: "Red Zone Monitor",
              desc: "Automated alerts fire when your KPIs fall below industry benchmarks. Each alert explains why it's happening and what to do about it.",
              accent: "#f05050",
            },
          ].map(f => (
            <div key={f.title} style={{ background: S1, border: "1px solid " + B1, borderRadius: 18, padding: "32px 28px", textAlign: "left", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${f.accent}80, transparent)` }} />
              <div style={{ width: 40, height: 3, background: f.accent, borderRadius: 2, marginBottom: 20, opacity: 0.7 }} />
              <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 10 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: "#b0b6b0", lineHeight: 1.7 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      <footer className="landing-footer" style={{ padding: "20px 40px", borderTop: "1px solid " + B1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: T3 }}>© Revenue Engine by Closer Control</div>
        <div style={{ display: "flex", gap: 20 }}>
          <Link to="/privacy" style={{ fontSize: 12, color: T3, textDecoration: "none" }}>Privacy</Link>
          <Link to="/terms" style={{ fontSize: 12, color: T3, textDecoration: "none" }}>Terms</Link>
        </div>
      </footer>
    </div>
  );
}
