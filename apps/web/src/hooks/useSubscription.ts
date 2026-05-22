import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { trackedQuery } from "@/lib/query-utils";

export interface SubscriptionInfo {
  status: string;
  planName: string;
  expiresAt: string | null;
  isActive: boolean;
  isExpired: boolean;
  isSuspended: boolean;
  seatsLimit: number | null;
  renewalNotes: string | null;
}

export function useSubscription(orgId: string | null) {
  return useQuery({
    queryKey: ["subscription", orgId],
    queryFn: () => trackedQuery("subscription", async (): Promise<SubscriptionInfo | null> => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error || !data) return null;
      const now = new Date();
      const expired = data.expires_at ? new Date(data.expires_at) < now : false;
      const statusExpired = data.plan_status === "expired" || expired;
      const isSuspended = data.plan_status === "suspended";
      const isActive = !statusExpired && !isSuspended && (data.plan_status === "active" || data.plan_status === "trial");
      return {
        status: data.plan_status,
        planName: data.plan_name,
        expiresAt: data.expires_at,
        isActive,
        isExpired: statusExpired,
        isSuspended,
        seatsLimit: data.seats_limit,
        renewalNotes: data.renewal_notes,
      };
    }),
    enabled: !!orgId,
  });
}
