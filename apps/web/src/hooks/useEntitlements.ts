import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription } from "./useSubscription";
import { trackedQuery } from "@/lib/query-utils";

export interface Entitlements {
  ai_enabled: boolean;
  exports_enabled: boolean;
  pdf_enabled: boolean;
  months_editable: number;
  team_enabled: boolean;
  financials_enabled: boolean;
  history_enabled: boolean;
}

const DISABLED: Entitlements = { ai_enabled: false, exports_enabled: false, pdf_enabled: false, months_editable: 0, team_enabled: false, financials_enabled: false, history_enabled: false };
const FULL: Entitlements = { ai_enabled: true, exports_enabled: true, pdf_enabled: true, months_editable: 1, team_enabled: true, financials_enabled: true, history_enabled: true };

export function useEntitlements(orgId: string | null) {
  const sub = useSubscription(orgId);

  return useQuery({
    queryKey: ["entitlements", sub.data?.planName, sub.data?.isActive],
    queryFn: () => trackedQuery("entitlements", async (): Promise<Entitlements> => {
      if (!sub.data) return DISABLED;
      if (!sub.data.isActive) return DISABLED;

      const { data } = await supabase
        .from("plan_entitlements" as any)
        .select("*")
        .eq("plan_name", sub.data.planName)
        .maybeSingle();

      if (!data) return FULL;
      return {
        ai_enabled: (data as any).ai_enabled ?? true,
        exports_enabled: (data as any).exports_enabled ?? true,
        pdf_enabled: (data as any).pdf_enabled ?? true,
        months_editable: (data as any).months_editable ?? 1,
        team_enabled: (data as any).team_enabled ?? true,
        financials_enabled: (data as any).financials_enabled ?? true,
        history_enabled: (data as any).history_enabled ?? true,
      };
    }),
    enabled: !!sub.data,
  });
}
