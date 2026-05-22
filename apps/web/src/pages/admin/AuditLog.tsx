import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";
import { useState } from "react";

export default function AuditLog() {
  const [filterOrg, setFilterOrg] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: orgs } = useQuery({
    queryKey: ["audit-orgs"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id, name").order("name");
      return data || [];
    },
  });

  const { data: logs, isLoading } = useQuery({
    queryKey: ["audit-logs", filterOrg, filterAction, filterFrom, filterTo],
    queryFn: async () => {
      let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (filterOrg) q = q.eq("org_id", filterOrg);
      if (filterAction) q = q.eq("action", filterAction);
      if (filterFrom) q = q.gte("created_at", filterFrom + "T00:00:00Z");
      if (filterTo) q = q.lte("created_at", filterTo + "T23:59:59Z");
      const { data } = await q;
      return (data as any[]) || [];
    },
  });

  const actions = [
    "create_org", "update_subscription", "extend_expiry", "suspend_subscription",
    "activate_subscription", "invite_admin", "invite_client", "impersonate_client",
    "stop_impersonation", "save_kpi_period", "update_kpi_period", "force_logout",
    "reset_to_trial",
  ];

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "9px 14px", color: TEXT, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif" };

  const actionColor = (action: string) => {
    if (action.includes("suspend") || action.includes("delete") || action.includes("force")) return RED;
    if (action.includes("impersonate")) return AMBER;
    return G;
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Audit Log</div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)} style={{ ...IS, width: 200, cursor: "pointer" }}>
            <option value="">All Organizations</option>
            {orgs?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} style={{ ...IS, width: 200, cursor: "pointer" }}>
            <option value="">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} placeholder="From" style={{ ...IS, width: 160 }} />
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} placeholder="To" style={{ ...IS, width: 160 }} />
          {(filterOrg || filterAction || filterFrom || filterTo) && (
            <button onClick={() => { setFilterOrg(""); setFilterAction(""); setFilterFrom(""); setFilterTo(""); }} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "9px 14px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>
          )}
        </div>

        {/* Log table */}
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Timestamp", "Actor", "Action", "Entity", "Org"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "14px 16px", fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .6, borderBottom: "1px solid " + B1, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs?.map((log: any) => (
                <>
                  <tr key={log.id} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)} style={{ borderBottom: "1px solid " + B1, cursor: "pointer" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: T2, fontFamily: "'DM Mono',monospace" }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 13, color: TEXT }}>{log.actor_role}</span>
                      <div style={{ fontSize: 11, color: T3, fontFamily: "monospace" }}>{log.actor_user_id?.slice(0, 8)}...</div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: actionColor(log.action), background: actionColor(log.action) + "12", border: "1px solid " + actionColor(log.action) + "30", borderRadius: 5, padding: "3px 10px" }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: T2 }}>{log.entity_type || "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: T3, fontFamily: "monospace" }}>{log.org_id?.slice(0, 8) || "—"}</td>
                  </tr>
                  {expandedId === log.id && (
                    <tr key={log.id + "-detail"}>
                      <td colSpan={5} style={{ padding: "0 16px 16px", background: S2 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "16px 0" }}>
                          {log.before_data && (
                            <div>
                              <div style={{ fontSize: 11, color: RED, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5, marginBottom: 8 }}>Before</div>
                              <pre style={{ fontSize: 12, color: T2, background: S3, border: "1px solid " + B2, borderRadius: 8, padding: 12, overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(log.before_data, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.after_data && (
                            <div>
                              <div style={{ fontSize: 11, color: G, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5, marginBottom: 8 }}>After</div>
                              <pre style={{ fontSize: 12, color: T2, background: S3, border: "1px solid " + B2, borderRadius: 8, padding: 12, overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(log.after_data, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.metadata && (
                            <div style={{ gridColumn: log.before_data || log.after_data ? undefined : "1 / -1" }}>
                              <div style={{ fontSize: 11, color: AMBER, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5, marginBottom: 8 }}>Metadata</div>
                              <pre style={{ fontSize: 12, color: T2, background: S3, border: "1px solid " + B2, borderRadius: 8, padding: 12, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                          {!log.before_data && !log.after_data && !log.metadata && (
                            <div style={{ color: T3, fontSize: 13 }}>No additional data recorded.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {(!logs || logs.length === 0) && (
                <tr><td colSpan={5} style={{ padding: "30px 16px", textAlign: "center", color: T3, fontSize: 14 }}>{isLoading ? "Loading..." : "No audit logs found"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
