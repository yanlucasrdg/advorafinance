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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      billing_webhook_events: {
        Row: {
          checkout_id: string | null
          error_message: string | null
          event_key: string
          event_type: string
          id: string
          processed_at: string | null
          processing_status: string
          received_at: string
          sale_id: string | null
          tenant_id: string | null
        }
        Insert: {
          checkout_id?: string | null
          error_message?: string | null
          event_key: string
          event_type: string
          id?: string
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          sale_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          checkout_id?: string | null
          error_message?: string | null
          event_key?: string
          event_type?: string
          id?: string
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          sale_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      case_movements: {
        Row: {
          case_id: string
          code: string | null
          complement: string | null
          created_at: string
          id: string
          name: string
          occurred_at: string
          raw: Json | null
          tenant_id: string
        }
        Insert: {
          case_id: string
          code?: string | null
          complement?: string | null
          created_at?: string
          id?: string
          name: string
          occurred_at: string
          raw?: Json | null
          tenant_id: string
        }
        Update: {
          case_id?: string
          code?: string | null
          complement?: string | null
          created_at?: string
          id?: string
          name?: string
          occurred_at?: string
          raw?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_movements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          area: string | null
          class_name: string | null
          client_id: string | null
          conversation_id: string | null
          court: string | null
          created_at: string
          datajud_synced_at: string | null
          deleted_at: string | null
          description: string | null
          distribution_date: string | null
          id: string
          instance: string | null
          last_movement_at: string | null
          lead_source: string | null
          lead_temperature: string
          next_deadline_at: string | null
          number: string | null
          parties: Json | null
          pipeline_stage: string
          pipeline_value_cents: number
          responsible: string | null
          status: string
          status_version: number
          subjects: Json | null
          tenant_id: string
          title: string
          tribunal: string | null
          updated_at: string
          value_cents: number | null
        }
        Insert: {
          area?: string | null
          class_name?: string | null
          client_id?: string | null
          conversation_id?: string | null
          court?: string | null
          created_at?: string
          datajud_synced_at?: string | null
          deleted_at?: string | null
          description?: string | null
          distribution_date?: string | null
          id?: string
          instance?: string | null
          last_movement_at?: string | null
          lead_source?: string | null
          lead_temperature?: string
          next_deadline_at?: string | null
          number?: string | null
          parties?: Json | null
          pipeline_stage?: string
          pipeline_value_cents?: number
          responsible?: string | null
          status?: string
          status_version?: number
          subjects?: Json | null
          tenant_id: string
          title: string
          tribunal?: string | null
          updated_at?: string
          value_cents?: number | null
        }
        Update: {
          area?: string | null
          class_name?: string | null
          client_id?: string | null
          conversation_id?: string | null
          court?: string | null
          created_at?: string
          datajud_synced_at?: string | null
          deleted_at?: string | null
          description?: string | null
          distribution_date?: string | null
          id?: string
          instance?: string | null
          last_movement_at?: string | null
          lead_source?: string | null
          lead_temperature?: string
          next_deadline_at?: string | null
          number?: string | null
          parties?: Json | null
          pipeline_stage?: string
          pipeline_value_cents?: number
          responsible?: string | null
          status?: string
          status_version?: number
          subjects?: Json | null
          tenant_id?: string
          title?: string
          tribunal?: string | null
          updated_at?: string
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          area: string | null
          city: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc: string | null
          email: string | null
          id: string
          is_hot: boolean
          name: string
          notes: string | null
          owner: string | null
          phone: string | null
          state: string | null
          stage_entered_at: string
          status: string
          status_version: number
          tenant_id: string
          type: string
          updated_at: string
          value_cents: number
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc?: string | null
          email?: string | null
          id?: string
          is_hot?: boolean
          name: string
          notes?: string | null
          owner?: string | null
          phone?: string | null
          state?: string | null
          stage_entered_at?: string
          status?: string
          status_version?: number
          tenant_id: string
          type?: string
          updated_at?: string
          value_cents?: number
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc?: string | null
          email?: string | null
          id?: string
          is_hot?: boolean
          name?: string
          notes?: string | null
          owner?: string | null
          phone?: string | null
          state?: string | null
          stage_entered_at?: string
          status?: string
          status_version?: number
          tenant_id?: string
          type?: string
          updated_at?: string
          value_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deadlines: {
        Row: {
          case_id: string | null
          client_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          done: boolean
          due_at: string
          id: string
          kind: string
          notes: string | null
          priority: string
          status_version: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          done?: boolean
          due_at: string
          id?: string
          kind?: string
          notes?: string | null
          priority?: string
          status_version?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          done?: boolean
          due_at?: string
          id?: string
          kind?: string
          notes?: string | null
          priority?: string
          status_version?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deadlines_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadlines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadlines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          case_id: string | null
          client_id: string | null
          created_at: string
          description: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          tenant_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          case_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          document_type?: string
          file_name: string
          file_path: string
          file_size?: number
          file_type: string
          id?: string
          tenant_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          case_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dre_settings: {
        Row: {
          apply_cogs: boolean
          category_map: Json
          enabled_categories: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          apply_cogs?: boolean
          category_map?: Json
          enabled_categories?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          apply_cogs?: boolean
          category_map?: Json
          enabled_categories?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dre_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entry_id: string | null
          id: string
          payment_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entry_id?: string | null
          id?: string
          payment_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entry_id?: string | null
          id?: string
          payment_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_audit_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_audit_log_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "financial_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_entries: {
        Row: {
          amount_cents: number
          case_id: string | null
          category: string | null
          client_id: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          id: string
          kind: string
          paid_amount_cents: number
          paid_at: string | null
          payment_method: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          settlement_status: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          case_id?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description: string
          due_date?: string | null
          id?: string
          kind?: string
          paid_amount_cents?: number
          paid_at?: string | null
          payment_method?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          settlement_status?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          case_id?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          due_date?: string | null
          id?: string
          kind?: string
          paid_amount_cents?: number
          paid_at?: string | null
          payment_method?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          settlement_status?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          entry_id: string
          id: string
          method: string | null
          notes: string | null
          paid_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          entry_id: string
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          entry_id?: string
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_payments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entry_id: string | null
          id: string
          kind: string
          link_action: string | null
          read_at: string | null
          severity: string
          tenant_id: string
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          kind: string
          link_action?: string | null
          read_at?: string | null
          severity?: string
          tenant_id: string
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          kind?: string
          link_action?: string | null
          read_at?: string | null
          severity?: string
          tenant_id?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          locale: string
          phone: string | null
          tenant_id: string | null
          theme: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          locale?: string
          phone?: string | null
          tenant_id?: string | null
          theme?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          phone?: string | null
          tenant_id?: string | null
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_branding: {
        Row: {
          brand_name: string
          created_at: string
          default_theme: string
          logo_url: string | null
          primary_color: string
          secondary_color: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          brand_name: string
          created_at?: string
          default_theme?: string
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          brand_name?: string
          created_at?: string
          default_theme?: string
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_branding_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          billing_interval: Database["public"]["Enums"]["billing_interval"] | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          customer_email: string | null
          grace_ends_at: string | null
          id: string
          kirvano_checkout_id: string | null
          kirvano_offer_id: string | null
          kirvano_product_id: string | null
          kirvano_sale_id: string | null
          last_event_at: string | null
          plan: Database["public"]["Enums"]["tenant_plan"]
          provider: string
          status: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          customer_email?: string | null
          grace_ends_at?: string | null
          id?: string
          kirvano_checkout_id?: string | null
          kirvano_offer_id?: string | null
          kirvano_product_id?: string | null
          kirvano_sale_id?: string | null
          last_event_at?: string | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          provider?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          customer_email?: string | null
          grace_ends_at?: string | null
          id?: string
          kirvano_checkout_id?: string | null
          kirvano_offer_id?: string | null
          kirvano_product_id?: string | null
          kirvano_sale_id?: string | null
          last_event_at?: string | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          provider?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          plan: Database["public"]["Enums"]["tenant_plan"]
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          plan?: Database["public"]["Enums"]["tenant_plan"]
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          plan?: Database["public"]["Enums"]["tenant_plan"]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          assignment_status: string
          category: string | null
          channel: string
          client_id: string | null
          contact_avatar: string | null
          contact_name: string | null
          contact_phone: string
          created_at: string
          id: string
          instance_id: string
          last_message: string | null
          last_message_at: string | null
          tags: string[]
          tenant_id: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          assignment_status?: string
          category?: string | null
          channel?: string
          client_id?: string | null
          contact_avatar?: string | null
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          id?: string
          instance_id: string
          last_message?: string | null
          last_message_at?: string | null
          tags?: string[]
          tenant_id: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          assignment_status?: string
          category?: string | null
          channel?: string
          client_id?: string | null
          contact_avatar?: string | null
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          id?: string
          instance_id?: string
          last_message?: string | null
          last_message_at?: string | null
          tags?: string[]
          tenant_id?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          external_instance_id: string | null
          id: string
          instance_name: string
          last_connected_at: string | null
          metadata: Json | null
          phone_number: string | null
          qr_code: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
          zapi_client_token: string | null
          zapi_instance_id: string | null
          zapi_token: string | null
        }
        Insert: {
          created_at?: string
          external_instance_id?: string | null
          id?: string
          instance_name: string
          last_connected_at?: string | null
          metadata?: Json | null
          phone_number?: string | null
          qr_code?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Update: {
          created_at?: string
          external_instance_id?: string | null
          id?: string
          instance_name?: string
          last_connected_at?: string | null
          metadata?: Json | null
          phone_number?: string | null
          qr_code?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_meta_connections: {
        Row: {
          access_token_ciphertext: string
          access_token_expires_at: string | null
          business_account_id: string
          connected_at: string | null
          created_at: string
          id: string
          instance_id: string
          last_error: string | null
          phone_number_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token_ciphertext: string
          access_token_expires_at?: string | null
          business_account_id: string
          connected_at?: string | null
          created_at?: string
          id?: string
          instance_id: string
          last_error?: string | null
          phone_number_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string
          access_token_expires_at?: string | null
          business_account_id?: string
          connected_at?: string | null
          created_at?: string
          id?: string
          instance_id?: string
          last_error?: string | null
          phone_number_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_meta_connections_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_meta_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_logs: {
        Row: {
          client_id: string | null
          created_at: string
          error: string | null
          id: string
          message: string
          payload: Json | null
          provider_message_id: string | null
          status: string
          tenant_id: string
          to_phone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message: string
          payload?: Json | null
          provider_message_id?: string | null
          status?: string
          tenant_id: string
          to_phone: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message?: string
          payload?: Json | null
          provider_message_id?: string | null
          status?: string
          tenant_id?: string
          to_phone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          direction: string
          external_message_id: string | null
          id: string
          status: string
          tenant_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          direction: string
          external_message_id?: string | null
          id?: string
          status?: string
          tenant_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          external_message_id?: string | null
          id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_rate_limit: {
        Args: { _scope: string }
        Returns: boolean
      }
      create_tenant_with_owner: {
        Args: { _name: string; _slug: string }
        Returns: string
      }
      create_deadline: {
        Args: {
          p_case_id?: string | null
          p_client_id?: string | null
          p_due_at: string
          p_kind: string
          p_notes?: string | null
          p_priority?: string
          p_title: string
        }
        Returns: Database["public"]["Tables"]["deadlines"]["Row"]
      }
      current_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_master_admin: { Args: { _user_id: string }; Returns: boolean }
      move_client_stage: {
        Args: {
          p_client_id: string
          p_expected_version: number
          p_next_status: string
        }
        Returns: Database["public"]["Tables"]["clients"]["Row"]
      }
      move_case_status: {
        Args: {
          p_case_id: string
          p_expected_version: number
          p_next_status: string
        }
        Returns: Database["public"]["Tables"]["cases"]["Row"]
      }
      metrics_agenda: { Args: never; Returns: Json }
      metrics_comunicacoes: { Args: never; Returns: Json }
      metrics_crm: { Args: never; Returns: Json }
      metrics_dashboard: { Args: never; Returns: Json }
      metrics_financeiro: {
        Args: {
          _area?: string
          _client_id?: string
          _from?: string
          _responsible?: string
          _to?: string
        }
        Returns: Json
      }
      metrics_processos: { Args: never; Returns: Json }
      notifications_summary: { Args: never; Returns: Json }
      reconcile_financial_entry: {
        Args: { _entry_id: string }
        Returns: undefined
      }
      soft_delete_client: {
        Args: { p_client_id: string }
        Returns: Database["public"]["Tables"]["clients"]["Row"]
      }
      soft_delete_case: {
        Args: { p_case_id: string; p_expected_version: number }
        Returns: Database["public"]["Tables"]["cases"]["Row"]
      }
      soft_delete_deadline: {
        Args: { p_deadline_id: string; p_expected_version: number }
        Returns: Database["public"]["Tables"]["deadlines"]["Row"]
      }
      toggle_deadline_completion: {
        Args: { p_deadline_id: string; p_expected_version: number }
        Returns: Database["public"]["Tables"]["deadlines"]["Row"]
      }
      update_deadline: {
        Args: { p_deadline_id: string; p_expected_version: number; p_patch: Json }
        Returns: Database["public"]["Tables"]["deadlines"]["Row"]
      }
      tz_today: { Args: never; Returns: string }
      user_in_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "master_admin"
        | "owner"
        | "admin"
        | "lawyer"
        | "secretary"
        | "intern"
        | "client"
      billing_interval: "monthly" | "annual"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "expired"
        | "refunded"
        | "chargeback"
      tenant_plan:
        | "trial"
        | "starter"
        | "professional"
        | "enterprise"
        | "essential"
        | "performance"
        | "business"
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
      app_role: [
        "master_admin",
        "owner",
        "admin",
        "lawyer",
        "secretary",
        "intern",
        "client",
      ],
      billing_interval: ["monthly", "annual"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "expired",
        "refunded",
        "chargeback",
      ],
      tenant_plan: [
        "trial",
        "starter",
        "professional",
        "enterprise",
        "essential",
        "performance",
        "business",
      ],
    },
  },
} as const
