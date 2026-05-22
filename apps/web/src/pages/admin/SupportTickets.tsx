import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminHeader from "@/components/AdminHeader";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, AMBER, RED } from "@/shared/kpi";
import { useState } from "react";

export default function AdminSupportTickets() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");

  const { data: tickets } = useQuery({
    queryKey: ["admin-support-tickets"],
    queryFn: async () => {
      const { data } = await supabase
        .from("support_tickets" as any)
        .select("*")
        .order("created_at", { ascending: false });

      // Get org names
      const orgIds = [...new Set((data || []).map((t: any) => t.org_id))];
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = Object.fromEntries((orgs || []).map(o => [o.id, o.name]));

      return ((data as any[]) || []).map(t => ({ ...t, org_name: orgMap[t.org_id] || "Unknown" }));
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await supabase.from("support_tickets" as any).update({ status } as any).eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] }),
  });

  const filtered = filter === "all" ? tickets : tickets?.filter((t: any) => t.status === filter);
  const statusColor = (s: string) => s === "open" ? AMBER : s === "closed" ? G : T3;

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <AdminHeader />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Support Tickets</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["all", "open", "closed"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ background: filter === f ? S3 : "transparent", border: "1px solid " + (filter === f ? B2 : "transparent"), borderRadius: 8, padding: "6px 14px", color: filter === f ? TEXT : T3, fontSize: 12, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Organization", "Subject", "Category", "Status", "Date", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "14px 16px", fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .6, borderBottom: "1px solid " + B1, fontWeight: 500 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(filtered || []).map((t: any) => (
                <tr key={t.id} style={{ borderBottom: "1px solid " + B1 }}>
                  <td style={{ padding: "14px 16px", fontSize: 14, fontWeight: 500 }}>{t.org_name}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{t.subject}</div>
                    <div style={{ fontSize: 12, color: T3, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.message}</div>
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: 12, color: T2 }}>{t.category}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(t.status), background: statusColor(t.status) + "12", borderRadius: 5, padding: "3px 10px" }}>{t.status}</span>
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: 12, color: T3 }}>{new Date(t.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "14px 16px" }}>
                    {t.status === "open" ? (
                      <button onClick={() => updateStatus.mutate({ id: t.id, status: "closed" })}
                        style={{ background: G + "12", border: "1px solid " + G + "30", borderRadius: 7, padding: "5px 10px", color: G, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Close</button>
                    ) : (
                      <button onClick={() => updateStatus.mutate({ id: t.id, status: "open" })}
                        style={{ background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "5px 10px", color: T2, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Reopen</button>
                    )}
                  </td>
                </tr>
              ))}
              {(!filtered || filtered.length === 0) && (
                <tr><td colSpan={6} style={{ padding: "30px 16px", textAlign: "center", color: T3, fontSize: 14 }}>No tickets found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
