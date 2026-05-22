export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          company_name: string
          created_at: string
          email: string
          full_name: string
          id: string
          message: string | null
          phone: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          company_name: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          message?: string | null
          phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          company_name?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string | null
          phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      activity_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_logs: {
        Row: {
          agent_key: string
          completion_tokens: number
          conversation_id: string | null
          cost_usd: number
          created_at: string
          id: string
          model: string
          org_id: string
          prompt_tokens: number
          total_tokens: number
          user_id: string
        }
        Insert: {
          agent_key: string
          completion_tokens?: number
          conversation_id?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          model?: string
          org_id: string
          prompt_tokens?: number
          total_tokens?: number
          user_id: string
        }
        Update: {
          agent_key?: string
          completion_tokens?: number
          conversation_id?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          model?: string
          org_id?: string
          prompt_tokens?: number
          total_tokens?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          org_id: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          org_id?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          org_id?: string | null
        }
        Relationships: []
      }
      billing_records: {
        Row: {
          amount_paid: number
          created_at: string | null
          created_by: string
          currency: string | null
          id: string
          internal_notes: string | null
          invoice_ref: string | null
          org_id: string
          paid_at: string
          payment_method: string | null
        }
        Insert: {
          amount_paid: number
          created_at?: string | null
          created_by: string
          currency?: string | null
          id?: string
          internal_notes?: string | null
          invoice_ref?: string | null
          org_id: string
          paid_at: string
          payment_method?: string | null
        }
        Update: {
          amount_paid?: number
          created_at?: string | null
          created_by?: string
          currency?: string | null
          id?: string
          internal_notes?: string | null
          invoice_ref?: string | null
          org_id?: string
          paid_at?: string
          payment_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          agent_key: string
          created_at: string
          id: string
          org_id: string
          period: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_key: string
          created_at?: string
          id?: string
          org_id: string
          period?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_key?: string
          created_at?: string
          id?: string
          org_id?: string
          period?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          org_id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          org_id: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_period_revisions: {
        Row: {
          created_at: string
          data: Json
          edited_by: string | null
          id: string
          kpi_period_id: string
          org_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          edited_by?: string | null
          id?: string
          kpi_period_id: string
          org_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          edited_by?: string | null
          id?: string
          kpi_period_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_period_revisions_kpi_period_id_fkey"
            columns: ["kpi_period_id"]
            isOneToOne: false
            referencedRelation: "kpi_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_period_revisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_periods: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_locked: boolean
          org_id: string
          period_start: string
          schema_version: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          is_locked?: boolean
          org_id: string
          period_start: string
          schema_version?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_locked?: boolean
          org_id?: string
          period_start?: string
          schema_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          created_at: string | null
          logo_url: string | null
          onboarding_dismissed: boolean | null
          org_id: string
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          logo_url?: string | null
          onboarding_dismissed?: boolean | null
          org_id: string
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          logo_url?: string | null
          onboarding_dismissed?: boolean | null
          org_id?: string
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      plan_entitlements: {
        Row: {
          ai_enabled: boolean | null
          exports_enabled: boolean | null
          financials_enabled: boolean | null
          history_enabled: boolean | null
          months_editable: number | null
          pdf_enabled: boolean | null
          plan_name: string
          team_enabled: boolean | null
        }
        Insert: {
          ai_enabled?: boolean | null
          exports_enabled?: boolean | null
          financials_enabled?: boolean | null
          history_enabled?: boolean | null
          months_editable?: number | null
          pdf_enabled?: boolean | null
          plan_name: string
          team_enabled?: boolean | null
        }
        Update: {
          ai_enabled?: boolean | null
          exports_enabled?: boolean | null
          financials_enabled?: boolean | null
          history_enabled?: boolean | null
          months_editable?: number | null
          pdf_enabled?: boolean | null
          plan_name?: string
          team_enabled?: boolean | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          last_login_at: string | null
          org_id: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          last_login_at?: string | null
          org_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          changed_by: string | null
          created_at: string
          event_type: string
          id: string
          new_expiry: string | null
          new_status: string | null
          org_id: string
          previous_expiry: string | null
          previous_status: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          event_type: string
          id?: string
          new_expiry?: string | null
          new_status?: string | null
          org_id: string
          previous_expiry?: string | null
          previous_status?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          event_type?: string
          id?: string
          new_expiry?: string | null
          new_status?: string | null
          org_id?: string
          previous_expiry?: string | null
          previous_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          org_id: string
          plan_name: string
          plan_status: Database["public"]["Enums"]["plan_status"]
          renewal_notes: string | null
          seats_limit: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          org_id: string
          plan_name?: string
          plan_status?: Database["public"]["Enums"]["plan_status"]
          renewal_notes?: string | null
          seats_limit?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          org_id?: string
          plan_name?: string
          plan_status?: Database["public"]["Enums"]["plan_status"]
          renewal_notes?: string | null
          seats_limit?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          created_at: string | null
          created_by: string
          id: string
          message: string
          org_id: string
          status: string
          subject: string
        }
        Insert: {
          category?: string
          created_at?: string | null
          created_by: string
          id?: string
          message: string
          org_id: string
          status?: string
          subject: string
        }
        Update: {
          category?: string
          created_at?: string | null
          created_by?: string
          id?: string
          message?: string
          org_id?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_expire_subscriptions: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      my_org_id: { Args: { _user_id: string }; Returns: string }
      subscription_is_active: { Args: { _org_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "super_admin" | "client_user"
      plan_status: "active" | "trial" | "expired" | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "client_user"],
      plan_status: ["active", "trial", "expired", "suspended"],
    },
  },
} as const
