import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, RED, AMBER } from "@/shared/kpi";

export default function AccessRequests() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["access-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("access_requests")
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["access-requests"] }),
  });

  const filtered = filter === "all" ? requests : requests.filter((r: any) => r.status === filter);
  const counts = {
    all: requests.length,
    pending: requests.filter((r: any) => r.status === "pending").length,
    approved: requests.filter((r: any) => r.status === "approved").length,
    rejected: requests.filter((r: any) => r.status === "rejected").length,
  };

  const statusColor = (s: string) => s === "pending" ? AMBER : s === "approved" ? G : RED;

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');`}</style>
      <AdminHeader />

      <main style={{ padding: "28px 28px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: TEXT }}>Access Requests</div>
            <div style={{ fontSize: 13, color: TEXT, marginTop: 4 }}>Review and manage incoming access requests</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {(["all", "pending", "approved", "rejected"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? (f === "all" ? S2 : statusColor(f) + "15") : S1,
              border: "1px solid " + (filter === f ? (f === "all" ? B2 : statusColor(f) + "40") : B1),
              borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: filter === f ? 600 : 400,
              color: filter === f ? (f === "all" ? TEXT : statusColor(f)) : T2,
              cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
            }}>
              {f} ({counts[f]})
            </button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: T3 }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 14, padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>No requests found</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((r: any) => (
              <div key={r.id} style={{ background: S1, border: "1px solid " + B1, borderRadius: 14, padding: "18px 22px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{r.full_name}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(r.status), background: statusColor(r.status) + "15", border: "1px solid " + statusColor(r.status) + "30", borderRadius: 5, padding: "2px 8px", textTransform: "capitalize" }}>{r.status}</span>
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: TEXT }}>📧 {r.email}</span>
                      <span style={{ fontSize: 13, color: TEXT }}>🏢 {r.company_name}</span>
                      {r.phone && <span style={{ fontSize: 13, color: TEXT }}>📞 {r.phone}</span>}
                    </div>
                    {r.message && <div style={{ fontSize: 13, color: TEXT, marginTop: 6, lineHeight: 1.6 }}>💬 {r.message}</div>}
                    <div style={{ fontSize: 11, color: T3, marginTop: 8 }}>Submitted: {new Date(r.created_at).toLocaleString()}</div>
                  </div>
                  {r.status === "pending" && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => updateStatus.mutate({ id: r.id, status: "approved" })} style={{ background: G + "15", border: "1px solid " + G + "30", borderRadius: 7, padding: "6px 14px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>✓ Approve</button>
                      <button onClick={() => updateStatus.mutate({ id: r.id, status: "rejected" })} style={{ background: RED + "15", border: "1px solid " + RED + "30", borderRadius: 7, padding: "6px 14px", color: RED, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>✗ Reject</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
