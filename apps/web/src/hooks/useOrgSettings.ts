import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { trackedQuery } from "@/lib/query-utils";

export interface OrgSettings {
  org_id: string;
  timezone: string;
  logo_url: string | null;
  onboarding_dismissed: boolean;
}

export function useOrgSettings(orgId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["org-settings", orgId],
    queryFn: () => trackedQuery("org-settings", async (): Promise<OrgSettings | null> => {
      if (!orgId) return null;
      const { data } = await supabase
        .from("org_settings" as any)
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();
      return data as any;
    }),
    enabled: !!orgId,
  });

  const upsert = useMutation({
    mutationFn: async (updates: Partial<OrgSettings>) => {
      if (!orgId) throw new Error("No org");
      const { error } = await supabase
        .from("org_settings" as any)
        .upsert({ org_id: orgId, ...updates } as any, { onConflict: "org_id" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-settings", orgId] }),
  });

  return { settings: query.data, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch, upsert };
}
