import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { S1, B1, B2, TEXT, T2, AMBER, RED } from "@/shared/kpi";
import { useState } from "react";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Clients", path: "/admin/clients" },
  { label: "+ New Client", path: "/admin/clients/new" },
  { label: "Audit Log", path: "/admin/audit" },
  { label: "Support", path: "/admin/support" },
  { label: "Admins", path: "/admin/admins" },
  { label: "Access Requests", path: "/admin/access-requests" },
  { label: "Plans", path: "/admin/plans" },
];

export default function AdminHeader() {
  const { signOut } = useAuth();
  const location = useLocation();
  const { isImpersonating, impersonatedOrgName, stopImpersonation } = useImpersonation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {isImpersonating && (
        <div className="sub-banner" style={{ background: "rgba(240,80,80,0.15)", borderBottom: "2px solid " + RED, padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: RED, fontSize: 14, fontWeight: 700 }}>🔴 You are impersonating {impersonatedOrgName}.</span>
          <button onClick={stopImpersonation} style={{ background: RED, border: "none", borderRadius: 8, padding: "6px 16px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Exit Impersonation</button>
        </div>
      )}
      <header className="admin-header" style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="admin-nav" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: AMBER }}>Admin Portal</div>
            <button
              onClick={() => setMenuOpen(p => !p)}
              className="admin-menu-toggle"
              style={{ display: "none", background: "transparent", border: "1px solid " + B2, borderRadius: 6, padding: "4px 8px", color: TEXT, fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}
            >
              ☰
            </button>
          </div>
          <style>{`
            @media (max-width: 768px) {
              .admin-menu-toggle { display: inline-flex !important; }
              .admin-nav-links { display: ${menuOpen ? "flex" : "none"} !important; flex-direction: column !important; width: 100% !important; gap: 4px !important; }
            }
          `}</style>
          <div className="admin-nav-links" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            {NAV_ITEMS.map(item => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    color: isActive ? TEXT : T2,
                    fontSize: 14,
                    textDecoration: "none",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "7px 16px", color: T2, fontSize: 13, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Sign Out</button>
      </header>
    </>
  );
}
