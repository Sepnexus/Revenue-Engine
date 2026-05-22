import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuditLog } from "@/hooks/useAuditLog";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";
import { useState } from "react";

export default function AdminsPage() {
  const { log } = useAuditLog();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reInvitingEmail, setReInvitingEmail] = useState<string | null>(null);

  const { data: admins, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "super_admin");
      if (!roles || roles.length === 0) return [];
      const userIds = roles.map((r) => r.user_id);
      const [{ data: profiles }, { data: authUsers }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, created_at").in("id", userIds),
        supabase.functions.invoke("admin-create-user", { body: { action: "list-users", userIds } }),
      ]);
      const users = authUsers?.users || [];
      return (profiles || []).map((p) => ({
        ...p,
        email: users.find((u: any) => u.id === p.id)?.email || "—",
      }));
    },
  });

  const inviteAdmin = useMutation({
    mutationFn: async () => {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "invite-user", email, fullName, role: "super_admin" },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      await log({ action: "invite_admin", entity_type: "user", after_data: { email, fullName } });
      return data;
    },
    onSuccess: (data: any) => {
      setSuccess(data?.reInvite ? "Admin re-invite sent ✓" : "Admin invitation sent ✓");
      setEmail(""); setFullName(""); setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setTimeout(() => setSuccess(""), 3000);
    },
    onError: (e: any) => setError(e.message || "Failed to invite admin"),
  });

  const reInviteAdmin = useMutation({
    mutationFn: async ({ adminEmail, adminName }: { adminEmail: string; adminName?: string }) => {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "invite-user", email: adminEmail, fullName: adminName || "", role: "super_admin" },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setSuccess("Admin re-invite sent ✓");
      setError(""); setReInvitingEmail(null);
      setTimeout(() => setSuccess(""), 3000);
    },
    onError: (e: any) => { setError(e.message || "Failed to re-invite admin"); setReInvitingEmail(null); },
  });

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Admin Users</div>

        {success && <div style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "10px 14px", color: G, fontSize: 14, marginBottom: 16 }}>{success}</div>}
        {error && <div style={{ background: RED + "15", border: "1px solid " + RED + "40", borderRadius: 8, padding: "10px 14px", color: RED, fontSize: 14, marginBottom: 16 }}>{error}</div>}

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10 }}>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name" style={IS} />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Admin Email" style={IS} />
          <button onClick={() => inviteAdmin.mutate()} disabled={inviteAdmin.isPending || !email.trim()} style={{ background: AMBER, border: "none", borderRadius: 9, padding: "0 18px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: inviteAdmin.isPending ? 0.6 : 1 }}>
            {inviteAdmin.isPending ? "Sending..." : "Invite Admin"}
          </button>
        </div>

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Email", "Created", "Action"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "14px 18px", fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .6, borderBottom: "1px solid " + B1, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admins?.map((a: any) => (
                <tr key={a.id} style={{ borderBottom: "1px solid " + B1 }}>
                  <td style={{ padding: "14px 18px", fontSize: 15, fontWeight: 600, color: TEXT }}>{a.full_name || "No name"}</td>
                  <td style={{ padding: "14px 18px", fontSize: 14, color: T2 }}>{a.email || "—"}</td>
                  <td style={{ padding: "14px 18px", fontSize: 13, color: T3 }}>{new Date(a.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "14px 18px" }}>
                    <button
                      onClick={() => { setReInvitingEmail(a.email); reInviteAdmin.mutate({ adminEmail: a.email, adminName: a.full_name || "" }); }}
                      disabled={!a.email || a.email === "—" || reInviteAdmin.isPending}
                      style={{ background: S2, border: "1px solid " + B2, borderRadius: 8, padding: "6px 12px", color: TEXT, fontSize: 12, cursor: !a.email || a.email === "—" || reInviteAdmin.isPending ? "not-allowed" : "pointer", opacity: !a.email || a.email === "—" || reInviteAdmin.isPending ? 0.6 : 1 }}>
                      {reInviteAdmin.isPending && reInvitingEmail === a.email ? "Sending..." : "Re-invite"}
                    </button>
                  </td>
                </tr>
              ))}
              {(!admins || admins.length === 0) && (
                <tr><td colSpan={4} style={{ padding: "30px 18px", textAlign: "center", color: T3, fontSize: 14 }}>{isLoading ? "Loading..." : "No admin users found"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
