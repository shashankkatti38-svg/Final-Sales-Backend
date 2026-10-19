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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          notes: string
          occurred_at: string
          organization_id: string
          owner_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          notes?: string
          occurred_at?: string
          organization_id?: string
          owner_id?: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string
          occurred_at?: string
          organization_id?: string
          owner_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_access_state: {
        Row: {
          blocked: boolean
          message: string
          owner_id: string
          status: number | null
          updated_at: string
        }
        Insert: {
          blocked?: boolean
          message?: string
          owner_id?: string
          status?: number | null
          updated_at?: string
        }
        Update: {
          blocked?: boolean
          message?: string
          owner_id?: string
          status?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      attendance: {
        Row: {
          check_in: string
          check_out: string | null
          created_at: string
          id: string
          in_lat: number | null
          in_lng: number | null
          notes: string
          organization_id: string
          out_lat: number | null
          out_lng: number | null
          owner_id: string
        }
        Insert: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          id?: string
          in_lat?: number | null
          in_lng?: number | null
          notes?: string
          organization_id?: string
          out_lat?: number | null
          out_lng?: number | null
          owner_id?: string
        }
        Update: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          id?: string
          in_lat?: number | null
          in_lng?: number | null
          notes?: string
          organization_id?: string
          out_lat?: number | null
          out_lng?: number | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action: string
          active: boolean
          created_at: string
          due_days: number
          id: string
          label: string
          match_status: string
          name: string
          organization_id: string
          runs: number
          task_title: string
          trigger_event: string
        }
        Insert: {
          action: string
          active?: boolean
          created_at?: string
          due_days?: number
          id?: string
          label?: string
          match_status?: string
          name: string
          organization_id: string
          runs?: number
          task_title?: string
          trigger_event: string
        }
        Update: {
          action?: string
          active?: boolean
          created_at?: string
          due_days?: number
          id?: string
          label?: string
          match_status?: string
          name?: string
          organization_id?: string
          runs?: number
          task_title?: string
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          created_at: string
          duration: number
          from_number: string
          id: string
          lead_id: string
          organization_id: string
          owner_id: string
          provider_sid: string | null
          recording_consent: boolean
          recording_deleted_at: string | null
          recording_path: string | null
          recording_sid: string | null
          rep_number: string
          request_id: string
          status: string
          summary: string | null
          to_number: string
          transcript: string | null
        }
        Insert: {
          created_at?: string
          duration?: number
          from_number: string
          id?: string
          lead_id: string
          organization_id?: string
          owner_id?: string
          provider_sid?: string | null
          recording_consent?: boolean
          recording_deleted_at?: string | null
          recording_path?: string | null
          recording_sid?: string | null
          rep_number: string
          request_id: string
          status?: string
          summary?: string | null
          to_number: string
          transcript?: string | null
        }
        Update: {
          created_at?: string
          duration?: number
          from_number?: string
          id?: string
          lead_id?: string
          organization_id?: string
          owner_id?: string
          provider_sid?: string | null
          recording_consent?: boolean
          recording_deleted_at?: string | null
          recording_path?: string | null
          recording_sid?: string | null
          rep_number?: string
          request_id?: string
          status?: string
          summary?: string | null
          to_number?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_files: {
        Row: {
          created_at: string
          description: string
          id: string
          mime: string
          name: string
          organization_id: string
          owner_id: string
          path: string
          size: number
          tag: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          mime?: string
          name: string
          organization_id?: string
          owner_id?: string
          path: string
          size?: number
          tag?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          mime?: string
          name?: string
          organization_id?: string
          owner_id?: string
          path?: string
          size?: number
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pages: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          tag: string
          title: string
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string
          tag?: string
          title: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string
          tag?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_cards: {
        Row: {
          about: string
          address: string
          company: string
          email: string
          full_name: string
          owner_id: string
          phone: string
          slug: string
          title: string
          updated_at: string
          website: string
          whatsapp: string
        }
        Insert: {
          about?: string
          address?: string
          company?: string
          email?: string
          full_name?: string
          owner_id?: string
          phone?: string
          slug?: string
          title?: string
          updated_at?: string
          website?: string
          whatsapp?: string
        }
        Update: {
          about?: string
          address?: string
          company?: string
          email?: string
          full_name?: string
          owner_id?: string
          phone?: string
          slug?: string
          title?: string
          updated_at?: string
          website?: string
          whatsapp?: string
        }
        Relationships: []
      }
      inbound_numbers: {
        Row: {
          created_at: string
          forward_to: string
          id: string
          organization_id: string
          phone_number: string
          provider_sid: string
        }
        Insert: {
          created_at?: string
          forward_to: string
          id?: string
          organization_id?: string
          phone_number: string
          provider_sid: string
        }
        Update: {
          created_at?: string
          forward_to?: string
          id?: string
          organization_id?: string
          phone_number?: string
          provider_sid?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incoming_calls: {
        Row: {
          call_sid: string
          created_at: string
          from_number: string
          id: string
          lead_company: string | null
          lead_id: string | null
          lead_name: string | null
          organization_id: string
          to_number: string
        }
        Insert: {
          call_sid: string
          created_at?: string
          from_number: string
          id?: string
          lead_company?: string | null
          lead_id?: string | null
          lead_name?: string | null
          organization_id: string
          to_number: string
        }
        Update: {
          call_sid?: string
          created_at?: string
          from_number?: string
          id?: string
          lead_company?: string | null
          lead_id?: string | null
          lead_name?: string | null
          organization_id?: string
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "incoming_calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incoming_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string
          assigned_to: string | null
          company: string
          contacted: boolean
          created_at: string
          email: string
          id: string
          label: string
          name: string
          organization_id: string
          owner_id: string
          phone: string
          renewal_date: string | null
          source: string
          status: string
          value: number
        }
        Insert: {
          address?: string
          assigned_to?: string | null
          company?: string
          contacted?: boolean
          created_at?: string
          email?: string
          id?: string
          label?: string
          name: string
          organization_id?: string
          owner_id?: string
          phone?: string
          renewal_date?: string | null
          source?: string
          status?: string
          value?: number
        }
        Update: {
          address?: string
          assigned_to?: string | null
          company?: string
          contacted?: boolean
          created_at?: string
          email?: string
          id?: string
          label?: string
          name?: string
          organization_id?: string
          owner_id?: string
          phone?: string
          renewal_date?: string | null
          source?: string
          status?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_checkins: {
        Row: {
          accuracy: number
          created_at: string
          id: string
          latitude: number
          lead_id: string | null
          longitude: number
          notes: string
          organization_id: string
          owner_id: string
        }
        Insert: {
          accuracy: number
          created_at?: string
          id?: string
          latitude: number
          lead_id?: string | null
          longitude: number
          notes?: string
          organization_id?: string
          owner_id?: string
        }
        Update: {
          accuracy?: number
          created_at?: string
          id?: string
          latitude?: number
          lead_id?: string | null
          longitude?: number
          notes?: string
          organization_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_checkins_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_checkins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_shares: {
        Row: {
          accuracy: number | null
          ended_at: string | null
          id: string
          lat: number | null
          lng: number | null
          organization_id: string
          owner_id: string
          reported_at: string
          started_at: string
          status: string
        }
        Insert: {
          accuracy?: number | null
          ended_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          organization_id?: string
          owner_id?: string
          reported_at?: string
          started_at?: string
          status?: string
        }
        Update: {
          accuracy?: number | null
          ended_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          organization_id?: string
          owner_id?: string
          reported_at?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          key: string
          read_at: string
          user_id: string
        }
        Insert: {
          key: string
          read_at?: string
          user_id?: string
        }
        Update: {
          key?: string
          read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          auto_assign: boolean
          bank_details: string
          created_at: string
          followup_days: number
          followup_enabled: boolean
          id: string
          invite_code: string
          name: string
          owner_id: string
          recording_retention_days: number
          rr_cursor: number
          shift_start: string
        }
        Insert: {
          auto_assign?: boolean
          bank_details?: string
          created_at?: string
          followup_days?: number
          followup_enabled?: boolean
          id?: string
          invite_code?: string
          name?: string
          owner_id: string
          recording_retention_days?: number
          rr_cursor?: number
          shift_start?: string
        }
        Update: {
          auto_assign?: boolean
          bank_details?: string
          created_at?: string
          followup_days?: number
          followup_enabled?: boolean
          id?: string
          invite_code?: string
          name?: string
          owner_id?: string
          recording_retention_days?: number
          rr_cursor?: number
          shift_start?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          method: string
          organization_id: string
          owner_id: string
          paid_at: string
          reference: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          method?: string
          organization_id?: string
          owner_id?: string
          paid_at?: string
          reference: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: string
          organization_id?: string
          owner_id?: string
          paid_at?: string
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string
          created_at: string
          description: string
          gst_rate: number
          id: string
          image_path: string | null
          name: string
          organization_id: string
          owner_id: string
          price: number
          sku: string
          unit: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          description?: string
          gst_rate?: number
          id?: string
          image_path?: string | null
          name: string
          organization_id?: string
          owner_id?: string
          price?: number
          sku?: string
          unit?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          description?: string
          gst_rate?: number
          id?: string
          image_path?: string | null
          name?: string
          organization_id?: string
          owner_id?: string
          price?: number
          sku?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      sales_documents: {
        Row: {
          approval: string
          approval_name: string
          approval_note: string
          approved_at: string | null
          created_at: string
          due_date: string | null
          id: string
          items: Json
          kind: string
          lead_id: string
          number: string
          organization_id: string
          owner_id: string
          parent_id: string | null
          share_token: string | null
          status: string
          total: number
        }
        Insert: {
          approval?: string
          approval_name?: string
          approval_note?: string
          approved_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          items?: Json
          kind: string
          lead_id: string
          number?: string
          organization_id?: string
          owner_id?: string
          parent_id?: string | null
          share_token?: string | null
          status?: string
          total: number
        }
        Update: {
          approval?: string
          approval_name?: string
          approval_note?: string
          approved_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          items?: Json
          kind?: string
          lead_id?: string
          number?: string
          organization_id?: string
          owner_id?: string
          parent_id?: string | null
          share_token?: string | null
          status?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          activities: number
          created_at: string
          deals: number
          id: string
          month: string
          organization_id: string
          revenue: number
          user_id: string
        }
        Insert: {
          activities?: number
          created_at?: string
          deals?: number
          id?: string
          month: string
          organization_id: string
          revenue?: number
          user_id: string
        }
        Update: {
          activities?: number
          created_at?: string
          deals?: number
          id?: string
          month?: string
          organization_id?: string
          revenue?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          audio_path: string | null
          completed: boolean
          created_at: string
          due_at: string
          id: string
          lead_id: string | null
          notes: string
          organization_id: string
          owner_id: string
          priority: string
          repeat: string
          task_type: string
          title: string
        }
        Insert: {
          audio_path?: string | null
          completed?: boolean
          created_at?: string
          due_at: string
          id?: string
          lead_id?: string | null
          notes?: string
          organization_id?: string
          owner_id?: string
          priority?: string
          repeat?: string
          task_type?: string
          title: string
        }
        Update: {
          audio_path?: string | null
          completed?: boolean
          created_at?: string
          due_at?: string
          id?: string
          lead_id?: string | null
          notes?: string
          organization_id?: string
          owner_id?: string
          priority?: string
          repeat?: string
          task_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      crm_assign_lead: {
        Args: { lead: string; rep: string }
        Returns: undefined
      }
      crm_is_admin: { Args: never; Returns: boolean }
      crm_join: { Args: { code: string }; Returns: string }
      crm_leaderboard: {
        Args: { month_start: string }
        Returns: {
          activities: number
          deals: number
          name: string
          revenue: number
          user_id: string
        }[]
      }
      crm_org: { Args: never; Returns: string }
      crm_remove_member: { Args: { member: string }; Returns: undefined }
      public_card: {
        Args: { card_slug: string }
        Returns: {
          about: string
          address: string
          company: string
          email: string
          full_name: string
          phone: string
          title: string
          website: string
          whatsapp: string
        }[]
      }
      public_quotation: {
        Args: { token: string }
        Returns: {
          approval: string
          approval_name: string
          approved_at: string
          company: string
          created_at: string
          items: Json
          lead_name: string
          number: string
          org_name: string
          total: number
        }[]
      }
      respond_quotation: {
        Args: { decision: string; note: string; signer: string; token: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
