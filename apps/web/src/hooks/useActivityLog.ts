import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { trackedQuery } from "@/lib/query-utils";

export function useActivityLog(orgId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const logActivity = useMutation({
    mutationFn: async ({ event_type, metadata }: { event_type: string; metadata?: any }) => {
      if (!orgId || !user) return;
      await supabase.from("activity_events" as any).insert({
        org_id: orgId,
        user_id: user.id,
        event_type,
        metadata,
      } as any);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["activity-events", orgId] }),
  });

  const events = useQuery({
    queryKey: ["activity-events", orgId],
    queryFn: () => trackedQuery("activity-events", async () => {
      if (!orgId) return [];
      const { data } = await supabase
        .from("activity_events" as any)
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
      return (data as any[]) || [];
    }),
    enabled: !!orgId,
  });

  return { logActivity, events: events.data || [], isLoading: events.isLoading, isError: events.isError, refetch: events.refetch };
}
