import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback } from "react";

interface AuditEntry {
  action: string;
  entity_type?: string;
  entity_id?: string;
  org_id?: string;
  before_data?: any;
  after_data?: any;
  metadata?: any;
}

export function useAuditLog() {
  const { user, role } = useAuth();

  const log = useCallback(async (entry: AuditEntry) => {
    if (!user) return;
    try {
      await supabase.from("audit_logs").insert({
        actor_user_id: user.id,
        actor_role: role || "unknown",
        org_id: entry.org_id || null,
        action: entry.action,
        entity_type: entry.entity_type || null,
        entity_id: entry.entity_id || null,
        before_data: entry.before_data || null,
        after_data: entry.after_data || null,
        metadata: entry.metadata || null,
      } as any);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  }, [user, role]);

  return { log };
}
