import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, B1, B2, TEXT, T2, T3, AMBER } from "@/shared/kpi";

const toExpiryIso = (date: string) => (date ? `${date}T23:59:59.999Z` : null);

export default function NewClient() {
  const { user } = useAuth();
  const { log } = useAuditLog();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [planStatus, setPlanStatus] = useState("trial");
  const [expiresAt, setExpiresAt] = useState("");
  const [renewalNotes, setRenewalNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .insert({ name: orgName, created_by: user?.id })
        .select()
        .single();
      if (orgErr) throw orgErr;

      const subPayload = {
        org_id: org.id,
        plan_name: "Custom",
        plan_status: planStatus as any,
        updated_by: user?.id,
        renewal_notes: renewalNotes || null,
        expires_at: toExpiryIso(expiresAt),
      };
      const { error: subErr } = await supabase.from("subscriptions").insert(subPayload);
      if (subErr) throw subErr;

      // Audit log
      await log({
        action: "create_org",
        entity_type: "organization",
        entity_id: org.id,
        org_id: org.id,
        after_data: { name: orgName, plan_status: planStatus, expires_at: toExpiryIso(expiresAt) },
      });

      // Subscription event
      await supabase.from("subscription_events").insert({
        org_id: org.id,
        changed_by: user?.id,
        event_type: "created",
        new_status: planStatus,
        new_expiry: toExpiryIso(expiresAt),
      } as any);

      navigate("/admin/clients/" + org.id);
    } catch (e: any) {
      setError(e.message || "Failed to create client");
      setLoading(false);
    }
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Create New Client</div>
        <div style={{ fontSize: 13, color: T3, marginBottom: 24 }}>User invitations are sent from the Client Details page.</div>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Organization</div>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Organization Name" style={IS} required />
          </div>

          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Subscription</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <select value={planStatus} onChange={(e) => setPlanStatus(e.target.value)} style={{ ...IS, cursor: "pointer" }}>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
              </select>
              <div>
                <div style={{ fontSize: 12, color: T3, marginBottom: 4 }}>Expiry Date</div>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={IS} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: T3, marginBottom: 4 }}>Renewal Notes</div>
                <input value={renewalNotes} onChange={(e) => setRenewalNotes(e.target.value)} placeholder="Optional renewal notes" style={IS} />
              </div>
            </div>
          </div>

          {error && <div style={{ color: "#f05050", fontSize: 13 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ background: AMBER, border: "none", borderRadius: 9, padding: "13px 16px", color: "#000", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Creating..." : "Create Client"}
          </button>
        </form>
      </main>
    </div>
  );
}
