import { Link } from "react-router-dom";
import { S1, B1, T2, T3, TEXT, G, AMBER } from "@/shared/kpi";

interface LockedFeatureProps {
  title: string;
  icon: string;
  description: string;
  ctaText?: string;
  ctaLink?: string;
}

export default function LockedFeature({ title, icon, description, ctaText = "Book a Call to Upgrade", ctaLink = "/app/support" }: LockedFeatureProps) {
  return (
    <div style={{
      background: S1,
      border: "1px solid " + B1,
      borderRadius: 16,
      padding: "48px 32px",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg," + AMBER + "60,transparent)" }} />
      <div style={{ fontSize: 40, marginBottom: 16 }}>{icon}</div>
      <span style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        color: AMBER,
        background: AMBER + "15",
        border: "1px solid " + AMBER + "30",
        borderRadius: 5,
        padding: "3px 12px",
        letterSpacing: 1,
        textTransform: "uppercase",
        marginBottom: 14,
      }}>
        Premium Feature
      </span>
      <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: T2, maxWidth: 420, margin: "0 auto 24px", lineHeight: 1.6 }}>{description}</div>
      <Link
        to={ctaLink}
        style={{
          display: "inline-block",
          background: G,
          border: "none",
          borderRadius: 9,
          padding: "12px 28px",
          color: "#000",
          fontWeight: 700,
          fontSize: 14,
          textDecoration: "none",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        {ctaText}
      </Link>
    </div>
  );
}
