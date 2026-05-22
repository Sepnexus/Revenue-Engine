import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getLast12, periodKey, normalizeKPIData, type KPIData } from "@/shared/kpi";
import { trackedQuery } from "@/lib/query-utils";

export interface PeriodInfo {
  data: KPIData;
  is_locked: boolean;
}

export function useKPIPeriods(orgId: string | null) {
  const queryClient = useQueryClient();

  const periodsQuery = useQuery({
    queryKey: ["kpi_periods", orgId],
    queryFn: () => trackedQuery("kpi_periods", async () => {
      if (!orgId) return {};
      const { data, error } = await supabase
        .from("kpi_periods")
        .select("*")
        .eq("org_id", orgId)
        .order("period_start", { ascending: false });
      if (error) throw error;
      const map: Record<string, PeriodInfo> = {};
      data?.forEach((row: any) => {
        // period_start is "YYYY-MM-DD" — parse parts directly to avoid timezone shift
        const [yStr, mStr] = (row.period_start as string).split("-");
        const key = periodKey(parseInt(mStr, 10) - 1, parseInt(yStr, 10));
        map[key] = { data: normalizeKPIData(row.data), is_locked: row.is_locked ?? false };
      });
      return map;
    }),
    enabled: !!orgId,
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ orgId, month, year, data }: { orgId: string; month: number; year: number; data: KPIData }) => {
      const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const { error } = await supabase
        .from("kpi_periods")
        .upsert(
          { org_id: orgId, period_start: periodStart, data: data as any, created_by: (await supabase.auth.getUser()).data.user?.id },
          { onConflict: "org_id,period_start" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi_periods", orgId] });
    },
  });

  const lockMutation = useMutation({
    mutationFn: async ({ orgId, month, year, locked }: { orgId: string; month: number; year: number; locked: boolean }) => {
      const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const { data: existing } = await supabase
        .from("kpi_periods")
        .select("id")
        .eq("org_id", orgId)
        .eq("period_start", periodStart)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("kpi_periods")
          .update({ is_locked: locked } as any)
          .eq("org_id", orgId)
          .eq("period_start", periodStart);
        if (error) throw error;
      } else {
        const { ZERO_DATA } = await import("@/shared/kpi");
        const { error } = await supabase
          .from("kpi_periods")
          .insert({ org_id: orgId, period_start: periodStart, data: ZERO_DATA as any, is_locked: locked, created_by: (await supabase.auth.getUser()).data.user?.id } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi_periods", orgId] });
    },
  });

  const EMPTY_MAP = useMemo<Record<string, PeriodInfo>>(() => ({}), []);
  const periodsMap = periodsQuery.data || EMPTY_MAP;

  return {
    periodsMap,
    isLoading: periodsQuery.isLoading,
    isError: periodsQuery.isError,
    error: periodsQuery.error,
    refetch: periodsQuery.refetch,
    savePeriod: upsertMutation.mutateAsync,
    isSaving: upsertMutation.isPending,
    toggleLock: lockMutation.mutateAsync,
    isLocking: lockMutation.isPending,
  };
}
