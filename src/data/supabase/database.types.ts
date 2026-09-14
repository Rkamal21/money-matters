export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          credit_limit_minor: number | null
          currency_code: string
          id: string
          institution: string | null
          is_archived: boolean
          last4: string | null
          name: string
          opening_balance_minor: number
          position: number
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credit_limit_minor?: number | null
          currency_code?: string
          id?: string
          institution?: string | null
          is_archived?: boolean
          last4?: string | null
          name: string
          opening_balance_minor?: number
          position?: number
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credit_limit_minor?: number | null
          currency_code?: string
          id?: string
          institution?: string | null
          is_archived?: boolean
          last4?: string | null
          name?: string
          opening_balance_minor?: number
          position?: number
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      achievements: {
        Row: {
          code: string
          created_at: string
          description: string
          icon: string
          is_active: boolean
          name: string
          sort_order: number
          xp_reward: number
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          icon?: string
          is_active?: boolean
          name: string
          sort_order?: number
          xp_reward?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          icon?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          xp_reward?: number
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          changed_fields: Json
          created_at: string
          id: number
          row_id: string
          table_name: string
          user_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          changed_fields?: Json
          created_at?: string
          id?: never
          row_id: string
          table_name: string
          user_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          changed_fields?: Json
          created_at?: string
          id?: never
          row_id?: string
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      budget_category_limits: {
        Row: {
          budget_period_id: string
          category_id: string
          created_at: string
          id: string
          limit_minor: number
          rollover_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_period_id: string
          category_id: string
          created_at?: string
          id?: string
          limit_minor: number
          rollover_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_period_id?: string
          category_id?: string
          created_at?: string
          id?: string
          limit_minor?: number
          rollover_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bcl_category_fk"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "bcl_period_fk"
            columns: ["budget_period_id", "user_id"]
            isOneToOne: false
            referencedRelation: "budget_periods"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      budget_periods: {
        Row: {
          closed_at: string | null
          created_at: string
          expected_income_minor: number
          id: string
          overall_limit_minor: number | null
          period: unknown
          planned_fixed_minor: number
          planned_savings_minor: number
          rollover_enabled: boolean
          rollover_in_minor: number
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          expected_income_minor?: number
          id?: string
          overall_limit_minor?: number | null
          period: unknown
          planned_fixed_minor?: number
          planned_savings_minor?: number
          rollover_enabled?: boolean
          rollover_in_minor?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          expected_income_minor?: number
          id?: string
          overall_limit_minor?: number | null
          period?: unknown
          planned_fixed_minor?: number
          planned_savings_minor?: number
          rollover_enabled?: boolean
          rollover_in_minor?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          is_archived: boolean
          is_system: boolean
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          parent_id: string | null
          position: number
          slug: string
          treatment: Database["public"]["Enums"]["category_treatment"]
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          kind?: Database["public"]["Enums"]["category_kind"]
          name: string
          parent_id?: string | null
          position?: number
          slug: string
          treatment?: Database["public"]["Enums"]["category_treatment"]
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          kind?: Database["public"]["Enums"]["category_kind"]
          name?: string
          parent_id?: string | null
          position?: number
          slug?: string
          treatment?: Database["public"]["Enums"]["category_treatment"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_fk"
            columns: ["parent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      gamification_events: {
        Row: {
          context: Json
          created_at: string
          dedupe_key: string
          id: string
          occurred_on: string
          type: Database["public"]["Enums"]["gamification_event_type"]
          user_id: string
          xp_awarded: number
        }
        Insert: {
          context?: Json
          created_at?: string
          dedupe_key: string
          id?: string
          occurred_on: string
          type: Database["public"]["Enums"]["gamification_event_type"]
          user_id: string
          xp_awarded: number
        }
        Update: {
          context?: Json
          created_at?: string
          dedupe_key?: string
          id?: string
          occurred_on?: string
          type?: Database["public"]["Enums"]["gamification_event_type"]
          user_id?: string
          xp_awarded?: number
        }
        Relationships: []
      }
      gamification_profiles: {
        Row: {
          created_at: string
          current_streak: number
          last_check_in_on: string | null
          longest_streak: number
          updated_at: string
          user_id: string
          xp_total: number
        }
        Insert: {
          created_at?: string
          current_streak?: number
          last_check_in_on?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
          xp_total?: number
        }
        Update: {
          created_at?: string
          current_streak?: number
          last_check_in_on?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
          xp_total?: number
        }
        Relationships: []
      }
      goals: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          priority: number
          target_date: string | null
          target_minor: number
          updated_at: string
          user_id: string
          wallet_account_id: string
          wallet_account_type: Database["public"]["Enums"]["account_type"]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          priority?: number
          target_date?: string | null
          target_minor: number
          updated_at?: string
          user_id: string
          wallet_account_id: string
          wallet_account_type?: Database["public"]["Enums"]["account_type"]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          priority?: number
          target_date?: string | null
          target_minor?: number
          updated_at?: string
          user_id?: string
          wallet_account_id?: string
          wallet_account_type?: Database["public"]["Enums"]["account_type"]
        }
        Relationships: [
          {
            foreignKeyName: "goals_wallet_fk"
            columns: ["wallet_account_id", "user_id", "wallet_account_type"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id", "type"]
          },
        ]
      }
      merchant_rules: {
        Row: {
          category_slug: string
          confidence: number
          created_at: string
          id: string
          is_enabled: boolean
          match_type: Database["public"]["Enums"]["match_type"]
          merchant_label: string
          pattern: string
          priority: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category_slug: string
          confidence?: number
          created_at?: string
          id?: string
          is_enabled?: boolean
          match_type?: Database["public"]["Enums"]["match_type"]
          merchant_label: string
          pattern: string
          priority?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category_slug?: string
          confidence?: number
          created_at?: string
          id?: string
          is_enabled?: boolean
          match_type?: Database["public"]["Enums"]["match_type"]
          merchant_label?: string
          pattern?: string
          priority?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          budget_period_start_day: number
          created_at: string
          currency_code: string
          display_name: string
          gamification_enabled: boolean
          id: string
          locale: string
          onboarding_completed_at: string | null
          onboarding_version: number
          timezone: string
          updated_at: string
        }
        Insert: {
          budget_period_start_day?: number
          created_at?: string
          currency_code?: string
          display_name?: string
          gamification_enabled?: boolean
          id: string
          locale?: string
          onboarding_completed_at?: string | null
          onboarding_version?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          budget_period_start_day?: number
          created_at?: string
          currency_code?: string
          display_name?: string
          gamification_enabled?: boolean
          id?: string
          locale?: string
          onboarding_completed_at?: string | null
          onboarding_version?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      transaction_splits: {
        Row: {
          amount_minor: number
          category_id: string
          created_at: string
          id: string
          note: string | null
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          category_id: string
          created_at?: string
          id?: string
          note?: string | null
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          category_id?: string
          created_at?: string
          id?: string
          note?: string | null
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "splits_category_fk"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "splits_transaction_fk"
            columns: ["transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transaction_category_amounts"
            referencedColumns: ["transaction_id", "user_id"]
          },
          {
            foreignKeyName: "splits_transaction_fk"
            columns: ["transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount_minor: number
          category_id: string | null
          client_request_id: string | null
          counter_account_id: string | null
          created_at: string
          currency_code: string
          dedupe_hash: string | null
          deleted_at: string | null
          description: string
          external_ref: string | null
          id: string
          is_split: boolean
          kind: Database["public"]["Enums"]["transaction_kind"]
          merchant_label: string | null
          metadata: Json
          notes: string | null
          occurred_at: string | null
          occurred_on: string
          refund_of_transaction_id: string | null
          source: Database["public"]["Enums"]["transaction_source"]
          status: Database["public"]["Enums"]["transaction_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount_minor: number
          category_id?: string | null
          client_request_id?: string | null
          counter_account_id?: string | null
          created_at?: string
          currency_code?: string
          dedupe_hash?: string | null
          deleted_at?: string | null
          description?: string
          external_ref?: string | null
          id?: string
          is_split?: boolean
          kind: Database["public"]["Enums"]["transaction_kind"]
          merchant_label?: string | null
          metadata?: Json
          notes?: string | null
          occurred_at?: string | null
          occurred_on: string
          refund_of_transaction_id?: string | null
          source?: Database["public"]["Enums"]["transaction_source"]
          status?: Database["public"]["Enums"]["transaction_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount_minor?: number
          category_id?: string | null
          client_request_id?: string | null
          counter_account_id?: string | null
          created_at?: string
          currency_code?: string
          dedupe_hash?: string | null
          deleted_at?: string | null
          description?: string
          external_ref?: string | null
          id?: string
          is_split?: boolean
          kind?: Database["public"]["Enums"]["transaction_kind"]
          merchant_label?: string | null
          metadata?: Json
          notes?: string | null
          occurred_at?: string | null
          occurred_on?: string
          refund_of_transaction_id?: string | null
          source?: Database["public"]["Enums"]["transaction_source"]
          status?: Database["public"]["Enums"]["transaction_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tx_account_fk"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "tx_account_fk"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tx_category_fk"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tx_counter_account_fk"
            columns: ["counter_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "tx_counter_account_fk"
            columns: ["counter_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tx_refund_of_fk"
            columns: ["refund_of_transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transaction_category_amounts"
            referencedColumns: ["transaction_id", "user_id"]
          },
          {
            foreignKeyName: "tx_refund_of_fk"
            columns: ["refund_of_transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_code: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_code: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_code?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_code_fkey"
            columns: ["achievement_code"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      account_balances: {
        Row: {
          account_id: string | null
          balance_minor: number | null
          currency_code: string | null
          user_id: string | null
        }
        Relationships: []
      }
      account_entries: {
        Row: {
          account_id: string | null
          currency_code: string | null
          leg: string | null
          occurred_on: string | null
          signed_amount_minor: number | null
          transaction_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      goal_progress: {
        Row: {
          balance_minor: number | null
          currency_code: string | null
          goal_id: string | null
          reached: boolean | null
          reached_on: string | null
          target_minor: number | null
          user_id: string | null
          wallet_account_id: string | null
        }
        Relationships: []
      }
      transaction_category_amounts: {
        Row: {
          amount_minor: number | null
          category_id: string | null
          kind: Database["public"]["Enums"]["transaction_kind"] | null
          occurred_on: string | null
          transaction_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      award_xp: {
        Args: {
          p_context?: Json
          p_dedupe_key: string
          p_occurred_on: string
          p_type: Database["public"]["Enums"]["gamification_event_type"]
          p_user_id: string
          p_xp: number
        }
        Returns: number
      }
      daily_check_in: {
        Args: { p_today: string }
        Returns: {
          created_at: string
          current_streak: number
          last_check_in_on: string | null
          longest_streak: number
          updated_at: string
          user_id: string
          xp_total: number
        }
        SetofOptions: {
          from: "*"
          to: "gamification_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_my_account: { Args: never; Returns: undefined }
      ensure_budget_period: {
        Args: { p_today: string }
        Returns: {
          closed_at: string | null
          created_at: string
          expected_income_minor: number
          id: string
          overall_limit_minor: number | null
          period: unknown
          planned_fixed_minor: number
          planned_savings_minor: number
          rollover_enabled: boolean
          rollover_in_minor: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "budget_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      evaluate_achievements: { Args: { p_user_id: string }; Returns: number }
      get_dashboard_snapshot: { Args: { p_today: string }; Returns: Json }
      get_monthly_comparison: {
        Args: { p_months?: number; p_today: string }
        Returns: {
          excluded_minor: number
          expense_minor: number
          fixed_minor: number
          income_minor: number
          period_end: string
          period_start: string
          planned_income_minor: number
          refund_minor: number
          variable_minor: number
          variable_refund_minor: number
        }[]
      }
      get_period_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          by_category: Json
          excluded_minor: number
          excluded_refund_minor: number
          expense_minor: number
          fixed_minor: number
          fixed_refund_minor: number
          income_minor: number
          refund_minor: number
          transaction_count: number
          transfer_in_minor: number
          transfer_out_minor: number
          variable_minor: number
          variable_refund_minor: number
        }[]
      }
      get_spending_over_time: {
        Args: { p_from: string; p_granularity?: string; p_to: string }
        Returns: {
          bucket: string
          expense_minor: number
          income_minor: number
          refund_minor: number
        }[]
      }
      is_valid_timezone: { Args: { p_tz: string }; Returns: boolean }
      period_remaining_minor: { Args: { p_period_id: string }; Returns: number }
      recompute_xp_totals: { Args: { p_user_id?: string }; Returns: number }
      replace_transaction_splits: {
        Args: {
          p_category_id?: string
          p_splits: Json
          p_transaction_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          client_request_id: string | null
          counter_account_id: string | null
          created_at: string
          currency_code: string
          dedupe_hash: string | null
          deleted_at: string | null
          description: string
          external_ref: string | null
          id: string
          is_split: boolean
          kind: Database["public"]["Enums"]["transaction_kind"]
          merchant_label: string | null
          metadata: Json
          notes: string | null
          occurred_at: string | null
          occurred_on: string
          refund_of_transaction_id: string | null
          source: Database["public"]["Enums"]["transaction_source"]
          status: Database["public"]["Enums"]["transaction_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_today: { Args: { p_user_id: string }; Returns: string }
    }
    Enums: {
      account_type: "cash" | "bank" | "savings" | "wallet" | "credit_card"
      category_kind: "expense" | "income"
      category_treatment: "fixed" | "variable" | "excluded"
      gamification_event_type:
        | "transaction_logged"
        | "daily_check_in"
        | "goal_contribution"
        | "goal_achieved"
        | "budget_reviewed"
        | "period_under_budget"
        | "achievement_unlocked"
        | "adjustment"
      match_type: "contains" | "prefix" | "exact"
      transaction_kind: "expense" | "income" | "transfer" | "refund"
      transaction_source:
        | "manual"
        | "sms"
        | "import"
        | "bank_sync"
        | "recurring"
        | "system"
      transaction_status:
        | "detected"
        | "pending_review"
        | "confirmed"
        | "rejected"
        | "duplicate"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_type: ["cash", "bank", "savings", "wallet", "credit_card"],
      category_kind: ["expense", "income"],
      category_treatment: ["fixed", "variable", "excluded"],
      gamification_event_type: [
        "transaction_logged",
        "daily_check_in",
        "goal_contribution",
        "goal_achieved",
        "budget_reviewed",
        "period_under_budget",
        "achievement_unlocked",
        "adjustment",
      ],
      match_type: ["contains", "prefix", "exact"],
      transaction_kind: ["expense", "income", "transfer", "refund"],
      transaction_source: [
        "manual",
        "sms",
        "import",
        "bank_sync",
        "recurring",
        "system",
      ],
      transaction_status: [
        "detected",
        "pending_review",
        "confirmed",
        "rejected",
        "duplicate",
      ],
    },
  },
} as const

