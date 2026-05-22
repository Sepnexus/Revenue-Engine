import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const toExpiryIso = (date: string) => (date ? `${date}T23:59:59.999Z` : null);

export default function ClientDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();
  const { startImpersonation, isImpersonating, impersonatedOrgName, stopImpersonation } = useImpersonation();
  const { log } = useAuditLog();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: org } = useQuery({
    queryKey: ["admin-org", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*, subscriptions(*), profiles(*)")
        .eq("id", orgId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const { data: userEmails } = useQuery({
    queryKey: ["admin-user-emails", orgId],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").eq("org_id", orgId!);
      if (!profiles || profiles.length === 0) return [];
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "list-users", userIds: profiles.map((p) => p.id) },
      });
      if (error || !data?.users) return profiles.map((p) => ({ id: p.id, full_name: p.full_name, email: "—" }));
      return profiles.map((p) => {
        const u = data.users.find((uu: any) => uu.id === p.id);
        return { id: p.id, full_name: p.full_name, email: u?.email || "—" };
      });
    },
    enabled: !!orgId,
  });

  // KPI period count
  const { data: kpiCount } = useQuery({
    queryKey: ["kpi-count", orgId],
    queryFn: async () => {
      const { count } = await supabase.from("kpi_periods").select("id", { count: "exact" }).eq("org_id", orgId!);
      return count || 0;
    },
    enabled: !!orgId,
  });

  // Subscription events timeline
  const { data: subEvents } = useQuery({
    queryKey: ["sub-events", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("subscription_events").select("*").eq("org_id", orgId!).order("created_at", { ascending: false }).limit(20);
      return (data as any[]) || [];
    },
    enabled: !!orgId,
  });

  // KPI revisions
  const [showRevisions, setShowRevisions] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const { data: revisions } = useQuery({
    queryKey: ["kpi-revisions", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("kpi_period_revisions").select("*").eq("org_id", orgId!).order("created_at", { ascending: false }).limit(50);
      return (data as any[]) || [];
    },
    enabled: !!orgId && showRevisions,
  });

  const { data: availablePlans } = useQuery({
    queryKey: ["admin-plans-list"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_entitlements" as any).select("plan_name").order("plan_name");
      return (data as any[])?.map((p: any) => p.plan_name) || [];
    },
  });

  const sub = Array.isArray(org?.subscriptions)
    ? (org?.subscriptions?.[0] as any)
    : (org?.subscriptions as any);
  const [orgName, setOrgName] = useState("");
  const [planStatus, setPlanStatus] = useState("trial");
  const [planName, setPlanName] = useState("Custom");
  const [expiresAt, setExpiresAt] = useState("");
  const [renewalNotes, setRenewalNotes] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setOrgName(org?.name || "");
    if (sub) {
      setPlanStatus(sub.plan_status || "trial");
      setPlanName(sub.plan_name || "Custom");
      setExpiresAt(sub.expires_at ? sub.expires_at.split("T")[0] : "");
      setRenewalNotes(sub.renewal_notes || "");
    }
  }, [org?.name, sub?.id, sub?.plan_status, sub?.plan_name, sub?.expires_at, sub?.renewal_notes]);

  const notify = (text: string, ms = 2200) => { setMsg(text); setTimeout(() => setMsg(""), ms); };

  const updateOrg = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("organizations").update({ name: orgName }).eq("id", orgId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      notify("Organization updated ✓");
    },
    onError: (e: any) => notify("Error: " + e.message, 3200),
  });

  const updateSub = useMutation({
    mutationFn: async (updates: any) => {
      const beforeData = { plan_status: sub?.plan_status, expires_at: sub?.expires_at, renewal_notes: sub?.renewal_notes };
      const payload = {
        org_id: orgId!,
        plan_name: updates.plan_name || "Custom",
        plan_status: updates.plan_status,
        expires_at: updates.expires_at,
        renewal_notes: updates.renewal_notes,
        updated_by: user?.id,
      };
      const { error } = await supabase.from("subscriptions").upsert(payload, { onConflict: "org_id" });
      if (error) throw error;

      // Determine event type
      let eventType = "update_subscription";
      if (updates.plan_status !== sub?.plan_status) {
        if (updates.plan_status === "suspended") eventType = "suspend_subscription";
        else if (updates.plan_status === "active") eventType = "activate_subscription";
      }
      if (updates.expires_at !== sub?.expires_at) eventType = "extend_expiry";

      await supabase.from("subscription_events").insert({
        org_id: orgId!,
        changed_by: user?.id,
        event_type: eventType,
        previous_status: sub?.plan_status,
        new_status: updates.plan_status,
        previous_expiry: sub?.expires_at,
        new_expiry: updates.expires_at,
      } as any);

      await log({
        action: eventType,
        entity_type: "subscription",
        org_id: orgId,
        before_data: beforeData,
        after_data: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      queryClient.invalidateQueries({ queryKey: ["sub-events", orgId] });
      notify("Subscription updated ✓");
    },
    onError: (e: any) => notify("Error: " + e.message, 3200),
  });

  const inviteClientUser = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "invite-user", fullName: inviteName, email: inviteEmail, orgId, role: "client_user" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await log({ action: "invite_client", entity_type: "user", org_id: orgId, after_data: { email: inviteEmail, fullName: inviteName } });
    },
    onSuccess: () => {
      setInviteEmail(""); setInviteName("");
      queryClient.invalidateQueries({ queryKey: ["admin-user-emails", orgId] });
      notify("Invitation sent ✓");
    },
    onError: (e: any) => notify("Error: " + e.message, 3200),
  });

  const reInviteClientUser = useMutation({
    mutationFn: async ({ email, fullName }: { email: string; fullName?: string }) => {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "invite-user", fullName: fullName || "", email, orgId, role: "client_user" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => notify("Re-invite sent ✓"),
    onError: (e: any) => notify("Error: " + e.message, 3200),
  });

  const handleSaveSub = () => {
    updateSub.mutate({ plan_name: planName, plan_status: planStatus, renewal_notes: renewalNotes || null, expires_at: toExpiryIso(expiresAt) });
  };

  const extend = (days: number) => {
    const base = expiresAt ? new Date(`${expiresAt}T00:00:00Z`) : new Date();
    base.setUTCDate(base.getUTCDate() + days);
    const next = base.toISOString().split("T")[0];
    setExpiresAt(next);
    updateSub.mutate({ plan_name: planName, plan_status: "active", renewal_notes: renewalNotes || null, expires_at: toExpiryIso(next) });
  };

  const resetToTrial = () => {
    setPlanStatus("trial");
    updateSub.mutate({ plan_name: planName, plan_status: "trial", renewal_notes: renewalNotes || null, expires_at: toExpiryIso(expiresAt) });
    log({ action: "reset_to_trial", entity_type: "subscription", org_id: orgId });
  };

  const handleImpersonate = async () => {
    if (!org) return;
    startImpersonation(org.id, org.name);
    await log({ action: "impersonate_client", entity_type: "organization", entity_id: orgId, org_id: orgId, metadata: { org_name: org.name } });
    navigate(`/admin/clients/${orgId}/revenue-engine`);
  };

  const forceLogout = async () => {
    await log({ action: "force_logout", entity_type: "organization", org_id: orgId, metadata: { org_name: org?.name } });
    notify("Force logout logged. Users will be signed out on next token refresh.");
  };

  const deleteOrg = useMutation({
    mutationFn: async () => {
      await log({ action: "delete_organization", entity_type: "organization", entity_id: orgId, org_id: orgId, metadata: { org_name: org?.name } });
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "delete-org", orgId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      navigate("/admin/clients");
    },
    onError: (e: any) => notify("Error: " + e.message, 4000),
  });

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "10px 14px", color: TEXT, fontSize: 15, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  const users = userEmails || (org?.profiles || []).map((p: any) => ({ id: p.id, full_name: p.full_name, email: "—" }));

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{org?.name || "Loading..."}</div>
          <div className="client-detail-actions" style={{ display: "flex", gap: 8 }}>
            <button onClick={handleImpersonate} style={{ background: AMBER + "15", border: "1px solid " + AMBER + "40", borderRadius: 8, padding: "8px 16px", color: AMBER, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              👤 Login as Client
            </button>
            <button onClick={forceLogout} style={{ background: RED + "12", border: "1px solid " + RED + "30", borderRadius: 8, padding: "8px 16px", color: RED, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Force Logout
            </button>
            <button onClick={() => setShowDeleteDialog(true)} style={{ background: RED + "18", border: "1px solid " + RED + "50", borderRadius: 8, padding: "8px 16px", color: RED, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              🗑️ Delete Client
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 14, color: T3, marginBottom: 24 }}>
          <span>ID: {orgId?.slice(0, 8)}...</span>
          <span>KPI Periods: {kpiCount ?? "..."}</span>
        </div>

        {msg && <div style={{ background: msg.startsWith("Error") ? RED + "15" : G + "15", border: "1px solid " + (msg.startsWith("Error") ? RED : G) + "40", borderRadius: 8, padding: "10px 14px", color: msg.startsWith("Error") ? RED : G, fontSize: 14, marginBottom: 16 }}>{msg}</div>}

        {/* Organization */}
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Organization</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Organization name" style={IS} />
            <button onClick={() => updateOrg.mutate()} disabled={updateOrg.isPending || !orgName.trim()} style={{ background: AMBER, border: "none", borderRadius: 8, padding: "0 18px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: updateOrg.isPending ? 0.6 : 1 }}>Save Name</button>
          </div>
        </div>

        {/* Users */}
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Users</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginBottom: 14 }}>
            <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" style={IS} />
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email" style={IS} />
            <button onClick={() => inviteClientUser.mutate()} disabled={inviteClientUser.isPending || !inviteEmail.trim()} style={{ background: G, border: "none", borderRadius: 8, padding: "0 18px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: inviteClientUser.isPending ? 0.6 : 1 }}>
              {inviteClientUser.isPending ? "Sending..." : "Invite Client"}
            </button>
          </div>
          {users.map((p: any) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid " + B1 }}>
              <div>
                <div style={{ fontSize: 15, color: TEXT, fontWeight: 500 }}>{p.full_name || "No name"}</div>
                <div style={{ fontSize: 13, color: T2 }}>{p.email || "—"}</div>
              </div>
              <button
                onClick={() => reInviteClientUser.mutate({ email: p.email, fullName: p.full_name || "" })}
                disabled={reInviteClientUser.isPending || !p.email || p.email === "—"}
                style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "6px 12px", color: TEXT, fontSize: 12, cursor: !p.email || p.email === "—" ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: reInviteClientUser.isPending || !p.email || p.email === "—" ? 0.6 : 1 }}>
                {reInviteClientUser.isPending ? "Sending..." : "Re-invite"}
              </button>
            </div>
          ))}
        </div>

        {/* Subscription */}
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 18 }}>Subscription</div>
          <div className="client-detail-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Plan</div>
              <select value={planName} onChange={(e) => setPlanName(e.target.value)} style={{ ...IS, cursor: "pointer" }}>
                <option value="Custom">Custom (All Features)</option>
                {(availablePlans || []).map((p: string) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Status</div>
              <select value={planStatus} onChange={(e) => setPlanStatus(e.target.value)} style={{ ...IS, cursor: "pointer" }}>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Expires At</div>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={IS} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 12, color: T3, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>Renewal Notes</div>
              <input value={renewalNotes} onChange={(e) => setRenewalNotes(e.target.value)} placeholder="Notes..." style={IS} />
            </div>
          </div>
          <div className="sub-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={handleSaveSub} disabled={updateSub.isPending} style={{ background: AMBER, border: "none", borderRadius: 8, padding: "10px 22px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: updateSub.isPending ? 0.6 : 1 }}>
              {updateSub.isPending ? "Saving..." : "Save Changes"}
            </button>
            <button onClick={() => extend(30)} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "10px 22px", color: TEXT, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>+30 Days</button>
            <button onClick={() => extend(90)} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "10px 22px", color: TEXT, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>+90 Days</button>
            <button onClick={resetToTrial} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "10px 22px", color: AMBER, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Reset to Trial</button>
          </div>
        </div>

        {/* Subscription Timeline */}
        {subEvents && subEvents.length > 0 && (
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Subscription Timeline</div>
            {subEvents.map((ev: any) => (
              <div key={ev.id} style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: "1px solid " + B1, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: T3, fontFamily: "'DM Mono',monospace", minWidth: 150 }}>{new Date(ev.created_at).toLocaleString()}</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: ev.event_type.includes("suspend") ? RED : ev.event_type.includes("extend") ? G : AMBER, background: (ev.event_type.includes("suspend") ? RED : ev.event_type.includes("extend") ? G : AMBER) + "12", borderRadius: 5, padding: "3px 10px" }}>{ev.event_type}</span>
                <span style={{ fontSize: 12, color: T2 }}>{ev.previous_status} → {ev.new_status}</span>
                {ev.previous_expiry !== ev.new_expiry && (
                  <span style={{ fontSize: 12, color: T3 }}>Expiry: {ev.new_expiry ? new Date(ev.new_expiry).toLocaleDateString() : "—"}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* KPI Revisions */}
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>KPI Revision History</div>
            <button onClick={() => setShowRevisions(p => !p)} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "8px 16px", color: TEXT, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
              {showRevisions ? "Hide Revisions" : "View Revisions"}
            </button>
          </div>
          {showRevisions && revisions && (
            revisions.length === 0
              ? <div style={{ fontSize: 14, color: T3 }}>No revisions recorded yet.</div>
              : revisions.map((rev: any) => (
                <details key={rev.id} style={{ borderBottom: "1px solid " + B1, padding: "10px 0" }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: TEXT }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", color: T3, fontSize: 12 }}>{new Date(rev.created_at).toLocaleString()}</span>
                    {" · "}
                    <span style={{ color: T2, fontSize: 12 }}>Period ID: {rev.kpi_period_id?.slice(0, 8)}...</span>
                    {rev.edited_by && <span style={{ color: T3, fontSize: 11 }}> · Editor: {rev.edited_by?.slice(0, 8)}...</span>}
                  </summary>
                  <pre style={{ fontSize: 12, color: T2, background: S2, border: "1px solid " + B2, borderRadius: 8, padding: 12, marginTop: 8, overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(rev.data, null, 2)}
                  </pre>
                </details>
              ))
          )}
        </div>

        {/* Billing (Internal) */}
        <BillingSection orgId={orgId!} userId={user?.id} />

        {/* AI Usage */}
        <AIUsageSection orgId={orgId!} />

        <Link to={`/admin/clients/${orgId}/revenue-engine`} style={{ display: "block", background: G + "12", border: "1px solid " + G + "30", borderRadius: 12, padding: "18px 24px", color: G, fontSize: 16, fontWeight: 600, textDecoration: "none", textAlign: "center" }}>
          Open Revenue Engine Dashboard →
        </Link>
      </main>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent style={{ background: BG, border: "1px solid " + B2, color: TEXT, fontFamily: "'DM Sans',sans-serif", maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle style={{ color: RED, fontSize: 18 }}>🗑️ Delete Client</DialogTitle>
            <DialogDescription style={{ color: T2, fontSize: 13 }}>
              This will permanently delete <strong style={{ color: TEXT }}>{org?.name}</strong> and all associated data including users, KPI periods, subscriptions, billing records, and chat history. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: T2, marginBottom: 8 }}>
              Type <strong style={{ color: RED }}>DELETE</strong> to confirm:
            </div>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              style={{ background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "10px 14px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" }}
            />
          </div>
          <DialogFooter style={{ gap: 8, marginTop: 8 }}>
            <button onClick={() => { setShowDeleteDialog(false); setDeleteConfirmText(""); }} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "10px 22px", color: TEXT, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button
              onClick={() => { deleteOrg.mutate(); setShowDeleteDialog(false); setDeleteConfirmText(""); }}
              disabled={deleteConfirmText !== "DELETE" || deleteOrg.isPending}
              style={{ background: RED, border: "none", borderRadius: 8, padding: "10px 22px", color: "#fff", fontWeight: 700, fontSize: 14, cursor: deleteConfirmText !== "DELETE" ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: deleteConfirmText !== "DELETE" || deleteOrg.isPending ? 0.5 : 1 }}
            >
              {deleteOrg.isPending ? "Deleting..." : "Delete Permanently"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── AI Usage Section (admin-only) ──────────────────────────
function AIUsageSection({ orgId }: { orgId: string }) {
  const { data: usageLogs } = useQuery({
    queryKey: ["ai-usage-logs", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("ai_usage_logs" as any).select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100);
      return (data as any[]) || [];
    },
    enabled: !!orgId,
  });

  const { data: conversations } = useQuery({
    queryKey: ["chat-conversations", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("chat_conversations" as any).select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50);
      return (data as any[]) || [];
    },
    enabled: !!orgId,
  });

  const totalTokens = (usageLogs || []).reduce((sum: number, l: any) => sum + (l.total_tokens || 0), 0);
  const totalCost = (usageLogs || []).reduce((sum: number, l: any) => sum + Number(l.cost_usd || 0), 0);
  const totalRequests = (usageLogs || []).length;
  const totalConversations = (conversations || []).length;

  // Group by agent
  const byAgent: Record<string, { tokens: number; cost: number; requests: number }> = {};
  (usageLogs || []).forEach((l: any) => {
    if (!byAgent[l.agent_key]) byAgent[l.agent_key] = { tokens: 0, cost: 0, requests: 0 };
    byAgent[l.agent_key].tokens += l.total_tokens || 0;
    byAgent[l.agent_key].cost += Number(l.cost_usd || 0);
    byAgent[l.agent_key].requests += 1;
  });

  const agentLabels: Record<string, string> = { diagnosing: "🔍 Diagnosing", prioritization: "🎯 Prioritization", simulation: "📊 Simulation" };

  return (
    <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>🤖 AI Usage & Costs</div>
      <div style={{ fontSize: 12, color: T3, marginBottom: 18 }}>Track token usage and costs for billing purposes.</div>

      <div className="client-detail-grid-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
        <div style={{ background: S2, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>Total Cost</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: G, fontFamily: "'DM Mono',monospace" }}>${totalCost.toFixed(4)}</div>
        </div>
        <div style={{ background: S2, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>Total Tokens</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{totalTokens.toLocaleString()}</div>
        </div>
        <div style={{ background: S2, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>API Requests</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{totalRequests}</div>
        </div>
        <div style={{ background: S2, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>Conversations</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{totalConversations}</div>
        </div>
      </div>

      {/* Breakdown by agent */}
      {Object.keys(byAgent).length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>Usage by Agent</div>
          <div className="client-detail-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {Object.entries(byAgent).map(([agent, stats]) => (
              <div key={agent} style={{ background: S2, border: "1px solid " + B2, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>{agentLabels[agent] || agent}</div>
                <div style={{ fontSize: 12, color: T2 }}>{stats.requests} requests · {stats.tokens.toLocaleString()} tokens</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: G, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>${stats.cost.toFixed(4)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent usage logs */}
      {usageLogs && usageLogs.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>Recent Usage</div>
          <div style={{ maxHeight: 250, overflowY: "auto" }}>
            {usageLogs.slice(0, 20).map((l: any) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderBottom: "1px solid " + B1, fontSize: 12 }}>
                <div style={{ color: T3, fontFamily: "'DM Mono',monospace", minWidth: 140 }}>{new Date(l.created_at).toLocaleString()}</div>
                <span style={{ color: TEXT, fontWeight: 500 }}>{agentLabels[l.agent_key] || l.agent_key}</span>
                <span style={{ color: T2 }}>{l.total_tokens?.toLocaleString()} tokens</span>
                <span style={{ color: G, fontWeight: 600, fontFamily: "'DM Mono',monospace" }}>${Number(l.cost_usd).toFixed(4)}</span>
                <span style={{ color: T3 }}>{l.model}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!usageLogs || usageLogs.length === 0) && (
        <div style={{ fontSize: 13, color: T3, textAlign: "center", padding: "20px 0" }}>No AI usage recorded yet for this client.</div>
      )}
    </div>
  );
}

// ── Billing Section (admin-only) ──────────────────────────
function BillingSection({ orgId, userId }: { orgId: string; userId?: string }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0]);
  const [method, setMethod] = useState("manual");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");

  const { data: payments } = useQuery({
    queryKey: ["billing-records", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("billing_records" as any).select("*").eq("org_id", orgId).order("paid_at", { ascending: false });
      return (data as any[]) || [];
    },
    enabled: !!orgId,
  });

  const totalPaid = (payments || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
  const lastPayment = payments?.[0];

  const addPayment = async () => {
    if (!amount || !userId) return;
    const { error } = await supabase.from("billing_records" as any).insert({
      org_id: orgId,
      amount_paid: Number(amount),
      paid_at: paidAt + "T00:00:00Z",
      payment_method: method,
      invoice_ref: invoiceRef || null,
      internal_notes: notes || null,
      created_by: userId,
    } as any);
    if (error) { setMsg("Error: " + error.message); } else {
      setMsg("Payment recorded ✓");
      setAmount(""); setInvoiceRef(""); setNotes("");
      queryClient.invalidateQueries({ queryKey: ["billing-records", orgId] });
    }
    setTimeout(() => setMsg(""), 3000);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "10px 14px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>💰 Billing (Internal)</div>
      <div style={{ fontSize: 12, color: T3, marginBottom: 18 }}>Admin-only. Not visible to clients.</div>

      {msg && <div style={{ background: msg.startsWith("Error") ? RED + "15" : G + "15", border: "1px solid " + (msg.startsWith("Error") ? RED : G) + "40", borderRadius: 8, padding: "8px 12px", color: msg.startsWith("Error") ? RED : G, fontSize: 13, marginBottom: 14 }}>{msg}</div>}

      <div className="client-detail-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
        <div style={{ background: S2, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>Lifetime Value</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: G, fontFamily: "'DM Mono',monospace" }}>${totalPaid.toLocaleString()}</div>
        </div>
        <div style={{ background: S2, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>Last Payment</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{lastPayment ? new Date(lastPayment.paid_at).toLocaleDateString() : "None"}</div>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 10 }}>Add Payment</div>
      <div className="client-billing-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Amount ($)</div>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={IS} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Date</div>
          <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} style={IS} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Method</div>
          <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...IS, cursor: "pointer" }}>
            <option value="manual">Manual</option>
            <option value="wire">Wire Transfer</option>
            <option value="check">Check</option>
            <option value="card">Card</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Invoice Ref</div>
          <input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="Optional" style={IS} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Internal Notes</div>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" style={IS} />
        </div>
      </div>
      <button onClick={addPayment} disabled={!amount} style={{ background: G, border: "none", borderRadius: 8, padding: "10px 22px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: !amount ? 0.5 : 1 }}>Record Payment</button>

      {payments && payments.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>Payment History</div>
          {payments.map((p: any) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 0", borderBottom: "1px solid " + B1 }}>
              <div style={{ fontSize: 13, color: T3, fontFamily: "'DM Mono',monospace", minWidth: 100 }}>{new Date(p.paid_at).toLocaleDateString()}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: G, fontFamily: "'DM Mono',monospace" }}>${Number(p.amount_paid).toLocaleString()}</div>
              <div style={{ fontSize: 12, color: T2 }}>{p.payment_method}</div>
              {p.invoice_ref && <div style={{ fontSize: 12, color: T3 }}>#{p.invoice_ref}</div>}
              {p.internal_notes && <div style={{ fontSize: 12, color: T3, fontStyle: "italic" }}>{p.internal_notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
