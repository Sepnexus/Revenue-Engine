import { useParams, Link } from "react-router-dom";
import Dashboard from "@/pages/app/Dashboard";
import { S1, B1, T2, AMBER, RED } from "@/shared/kpi";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useAuditLog } from "@/hooks/useAuditLog";

export default function AdminClientDashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const { signOut } = useAuth();
  const { isImpersonating, impersonatedOrgName, stopImpersonation } = useImpersonation();
  const { log } = useAuditLog();

  const handleStopImpersonation = () => {
    stopImpersonation();
    log({ action: "stop_impersonation", org_id: orgId });
  };

  return (
    <div>
      {isImpersonating && (
        <div style={{ background: "rgba(240,80,80,0.15)", borderBottom: "2px solid " + RED, padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 10000 }}>
          <span style={{ color: RED, fontSize: 14, fontWeight: 700 }}>🔴 You are impersonating {impersonatedOrgName}.</span>
          <button onClick={handleStopImpersonation} style={{ background: RED, border: "none", borderRadius: 8, padding: "6px 16px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Exit Impersonation</button>
        </div>
      )}
      <div style={{ background: S1, borderBottom: "1px solid " + B1, padding: "8px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 9999 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: AMBER }}>Admin View</span>
          <Link to={`/admin/clients/${orgId}`} style={{ color: T2, fontSize: 11, textDecoration: "none" }}>← Back to Client</Link>
        </div>
      </div>
      <Dashboard adminOrgId={orgId} />
    </div>
  );
}
