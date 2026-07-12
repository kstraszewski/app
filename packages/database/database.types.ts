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
      appointment_calendar_events: {
        Row: {
          appointment_id: string
          calendar_id: string
          connection_id: string
          created_at: string
          external_event_id: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string
          provider_etag: string | null
          source_fingerprint: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          calendar_id: string
          connection_id: string
          created_at?: string
          external_event_id: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id: string
          provider_etag?: string | null
          source_fingerprint?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          calendar_id?: string
          connection_id?: string
          created_at?: string
          external_event_id?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string
          provider_etag?: string | null
          source_fingerprint?: string | null
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_calendar_events_appointment_fkey"
            columns: ["organization_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointment_calendar_events_connection_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      appointment_resource_reservations: {
        Row: {
          appointment_id: string
          busy_period: unknown
          created_at: string
          hold_expires_at: string | null
          id: string
          organization_id: string
          resource_id: string
          resource_type: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          busy_period: unknown
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          organization_id: string
          resource_id: string
          resource_type: string
          status: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          busy_period?: unknown
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          organization_id?: string
          resource_id?: string
          resource_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_resource_reservations_appointment_fkey"
            columns: ["organization_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_period: unknown
          booking_context: Json
          cancellation_reason: string | null
          cancelled_at: string | null
          client_id: string
          client_person_id: string | null
          confirmed_at: string | null
          created_at: string
          created_by_user_id: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          ends_at: string
          expert_user_id: string
          facility_id: string
          hold_expires_at: string | null
          id: string
          idempotency_key: string | null
          manage_token: string
          notes: string | null
          organization_id: string
          request_fingerprint: string | null
          service_id: string
          source: string
          starts_at: string
          status: string
          timezone: string
          updated_at: string
          widget_id: string | null
        }
        Insert: {
          appointment_period?: unknown
          booking_context?: Json
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id: string
          client_person_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          ends_at: string
          expert_user_id: string
          facility_id: string
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          manage_token?: string
          notes?: string | null
          organization_id: string
          request_fingerprint?: string | null
          service_id: string
          source?: string
          starts_at: string
          status?: string
          timezone: string
          updated_at?: string
          widget_id?: string | null
        }
        Update: {
          appointment_period?: unknown
          booking_context?: Json
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string
          client_person_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          ends_at?: string
          expert_user_id?: string
          facility_id?: string
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          manage_token?: string
          notes?: string | null
          organization_id?: string
          request_fingerprint?: string | null
          service_id?: string
          source?: string
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
          widget_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_client_person_fkey"
            columns: ["organization_id", "client_id", "client_person_id"]
            isOneToOne: false
            referencedRelation: "crm_client_people"
            referencedColumns: ["organization_id", "client_id", "id"]
          },
          {
            foreignKeyName: "appointments_created_by_member_fkey"
            columns: ["organization_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "appointments_expert_user_fkey"
            columns: ["expert_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_widget_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "booking_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_outbox: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          attempts: number
          available_at: string
          created_at: string
          id: number
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          payload: Json
          processed_at: string | null
          status: string
          topic: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          attempts?: number
          available_at?: string
          created_at?: string
          id?: never
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          organization_id: string
          payload?: Json
          processed_at?: string | null
          status?: string
          topic: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          attempts?: number
          available_at?: string
          created_at?: string
          id?: never
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rate_limits: {
        Row: {
          client_key: string
          rate_scope: string
          request_count: number
          widget_id: string
          window_started_at: string
        }
        Insert: {
          client_key: string
          rate_scope: string
          request_count?: number
          widget_id: string
          window_started_at: string
        }
        Update: {
          client_key?: string
          rate_scope?: string
          request_count?: number
          widget_id?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_rate_limits_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "booking_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_services: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          max_advance_days: number
          min_notice_minutes: number
          name: string
          organization_id: string
          slot_interval_minutes: number
          slug: string
          updated_at: string
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          max_advance_days?: number
          min_notice_minutes?: number
          name: string
          organization_id: string
          slot_interval_minutes?: number
          slug: string
          updated_at?: string
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          max_advance_days?: number
          min_notice_minutes?: number
          name?: string
          organization_id?: string
          slot_interval_minutes?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_widget_services: {
        Row: {
          created_at: string
          facility_id: string
          organization_id: string
          service_id: string
          widget_id: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          organization_id: string
          service_id: string
          widget_id: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          organization_id?: string
          service_id?: string
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_widget_services_facility_service_fkey"
            columns: ["organization_id", "facility_id", "service_id"]
            isOneToOne: false
            referencedRelation: "facility_services"
            referencedColumns: ["organization_id", "facility_id", "service_id"]
          },
          {
            foreignKeyName: "booking_widget_services_widget_fkey"
            columns: ["organization_id", "facility_id", "widget_id"]
            isOneToOne: false
            referencedRelation: "booking_widgets"
            referencedColumns: ["organization_id", "facility_id", "id"]
          },
        ]
      }
      booking_widgets: {
        Row: {
          accent_color: string
          allowed_origins: string[]
          booking_mode: string
          created_at: string
          created_by_user_id: string | null
          facility_id: string
          fixed_expert_user_id: string | null
          id: string
          is_active: boolean
          locale: string
          name: string
          organization_id: string
          public_token: string
          slug: string
          subtitle: string | null
          theme: string
          title: string
          updated_at: string
          widget_type: string
        }
        Insert: {
          accent_color?: string
          allowed_origins?: string[]
          booking_mode?: string
          created_at?: string
          created_by_user_id?: string | null
          facility_id: string
          fixed_expert_user_id?: string | null
          id?: string
          is_active?: boolean
          locale?: string
          name: string
          organization_id: string
          public_token?: string
          slug: string
          subtitle?: string | null
          theme?: string
          title: string
          updated_at?: string
          widget_type?: string
        }
        Update: {
          accent_color?: string
          allowed_origins?: string[]
          booking_mode?: string
          created_at?: string
          created_by_user_id?: string | null
          facility_id?: string
          fixed_expert_user_id?: string | null
          id?: string
          is_active?: boolean
          locale?: string
          name?: string
          organization_id?: string
          public_token?: string
          slug?: string
          subtitle?: string | null
          theme?: string
          title?: string
          updated_at?: string
          widget_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_widgets_created_by_fkey"
            columns: ["organization_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "booking_widgets_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "booking_widgets_fixed_expert_fkey"
            columns: ["organization_id", "facility_id", "fixed_expert_user_id"]
            isOneToOne: false
            referencedRelation: "facility_memberships"
            referencedColumns: ["organization_id", "facility_id", "user_id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          account_email: string | null
          account_id: string
          created_at: string
          encrypted_access_token: string | null
          encrypted_refresh_token: string | null
          facility_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string
          owner_kind: string
          owner_user_id: string | null
          provider: string
          read_calendar_ids: string[]
          scopes: string[]
          selected_calendar_id: string | null
          selected_calendar_name: string | null
          status: string
          sync_cursor: string | null
          token_expires_at: string | null
          updated_at: string
          webhook_channel_id: string | null
          webhook_client_state_encrypted: string | null
          webhook_expires_at: string | null
          webhook_resource_id: string | null
        }
        Insert: {
          account_email?: string | null
          account_id: string
          created_at?: string
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          facility_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id: string
          owner_kind: string
          owner_user_id?: string | null
          provider: string
          read_calendar_ids?: string[]
          scopes?: string[]
          selected_calendar_id?: string | null
          selected_calendar_name?: string | null
          status?: string
          sync_cursor?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_channel_id?: string | null
          webhook_client_state_encrypted?: string | null
          webhook_expires_at?: string | null
          webhook_resource_id?: string | null
        }
        Update: {
          account_email?: string | null
          account_id?: string
          created_at?: string
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          facility_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string
          owner_kind?: string
          owner_user_id?: string | null
          provider?: string
          read_calendar_ids?: string[]
          scopes?: string[]
          selected_calendar_id?: string | null
          selected_calendar_name?: string | null
          status?: string
          sync_cursor?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_channel_id?: string | null
          webhook_client_state_encrypted?: string | null
          webhook_expires_at?: string | null
          webhook_resource_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "calendar_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_connections_owner_user_fkey"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: string
          actor_user_id: string | null
          body: string | null
          case_id: string | null
          case_item_id: string | null
          client_id: string | null
          created_at: string
          id: string
          organization_id: string
          payload: Json
          submission_id: string | null
          title: string
        }
        Insert: {
          activity_type: string
          actor_user_id?: string | null
          body?: string | null
          case_id?: string | null
          case_item_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          payload?: Json
          submission_id?: string | null
          title: string
        }
        Update: {
          activity_type?: string
          actor_user_id?: string | null
          body?: string | null
          case_id?: string | null
          case_item_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          submission_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_case_item_id_fkey"
            columns: ["case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_organization_actor_membership_fkey"
            columns: ["organization_id", "actor_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_activities_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_activities_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_organization_item_fkey"
            columns: ["organization_id", "case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_activities_organization_submission_fkey"
            columns: ["organization_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "crm_item_submissions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_activities_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "crm_item_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_case_item_settlements: {
        Row: {
          case_item_id: string
          created_at: string
          currency: string
          due_amount: number
          due_date: string | null
          expected_amount: number
          id: string
          metadata: Json
          notes: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          payer_provider_id: string | null
          status_code: string
          updated_at: string
        }
        Insert: {
          case_item_id: string
          created_at?: string
          currency?: string
          due_amount?: number
          due_date?: string | null
          expected_amount?: number
          id?: string
          metadata?: Json
          notes?: string | null
          organization_id: string
          paid_amount?: number
          paid_at?: string | null
          payer_provider_id?: string | null
          status_code?: string
          updated_at?: string
        }
        Update: {
          case_item_id?: string
          created_at?: string
          currency?: string
          due_amount?: number
          due_date?: string | null
          expected_amount?: number
          id?: string
          metadata?: Json
          notes?: string | null
          organization_id?: string
          paid_amount?: number
          paid_at?: string | null
          payer_provider_id?: string | null
          status_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_item_settlements_case_item_id_fkey"
            columns: ["case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_item_settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_item_settlements_payer_provider_id_fkey"
            columns: ["payer_provider_id"]
            isOneToOne: false
            referencedRelation: "crm_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_settlements_organization_item_fkey"
            columns: ["organization_id", "case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_settlements_organization_payer_fkey"
            columns: ["organization_id", "payer_provider_id"]
            isOneToOne: false
            referencedRelation: "crm_providers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      crm_case_items: {
        Row: {
          amount_value: number | null
          case_id: string
          created_at: string
          currency: string
          expected_close_date: string | null
          id: string
          lost_at: string | null
          metadata: Json
          organization_id: string
          owner_user_id: string | null
          product_type_id: string
          status_code: string
          title: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          amount_value?: number | null
          case_id: string
          created_at?: string
          currency?: string
          expected_close_date?: string | null
          id?: string
          lost_at?: string | null
          metadata?: Json
          organization_id: string
          owner_user_id?: string | null
          product_type_id: string
          status_code?: string
          title: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          amount_value?: number | null
          case_id?: string
          created_at?: string
          currency?: string
          expected_close_date?: string | null
          id?: string
          lost_at?: string | null
          metadata?: Json
          organization_id?: string
          owner_user_id?: string | null
          product_type_id?: string
          status_code?: string
          title?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_items_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_items_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_items_organization_owner_membership_fkey"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_case_items_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_items_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "crm_product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_case_participants: {
        Row: {
          case_id: string
          created_at: string
          id: string
          organization_id: string
          person_id: string
          role: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          organization_id: string
          person_id: string
          role: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          person_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_participants_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_participants_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_participants_organization_person_fkey"
            columns: ["organization_id", "person_id"]
            isOneToOne: false
            referencedRelation: "crm_client_people"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_participants_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "crm_client_people"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cases: {
        Row: {
          client_id: string
          closed_at: string | null
          created_at: string
          description: string | null
          id: string
          metadata: Json
          opened_at: string
          organization_id: string
          owner_user_id: string | null
          priority: string
          progress_percent: number
          status_code: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          closed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          opened_at?: string
          organization_id: string
          owner_user_id?: string | null
          priority?: string
          progress_percent?: number
          status_code?: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          closed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          opened_at?: string
          organization_id?: string
          owner_user_id?: string | null
          priority?: string
          progress_percent?: number
          status_code?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cases_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cases_organization_owner_membership_fkey"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_cases_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_consent_events: {
        Row: {
          client_id: string
          contact_value: string | null
          created_at: string
          decision: string
          definition_id: string
          definition_version_id: string
          evidence_reference: string | null
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          recorded_by_user_id: string | null
          source: string
          subject_person_id: string
        }
        Insert: {
          client_id: string
          contact_value?: string | null
          created_at?: string
          decision: string
          definition_id: string
          definition_version_id: string
          evidence_reference?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          recorded_by_user_id?: string | null
          source: string
          subject_person_id: string
        }
        Update: {
          client_id?: string
          contact_value?: string | null
          created_at?: string
          decision?: string
          definition_id?: string
          definition_version_id?: string
          evidence_reference?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          recorded_by_user_id?: string | null
          source?: string
          subject_person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_consent_events_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_client_consent_events_definition_fkey"
            columns: ["organization_id", "definition_id"]
            isOneToOne: false
            referencedRelation: "crm_consent_definitions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_client_consent_events_person_fkey"
            columns: ["organization_id", "subject_person_id"]
            isOneToOne: false
            referencedRelation: "crm_client_people"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_client_consent_events_recorded_by_fkey"
            columns: ["organization_id", "recorded_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_client_consent_events_version_fkey"
            columns: [
              "organization_id",
              "definition_id",
              "definition_version_id",
            ]
            isOneToOne: false
            referencedRelation: "crm_consent_definition_versions"
            referencedColumns: ["organization_id", "definition_id", "id"]
          },
        ]
      }
      crm_client_people: {
        Row: {
          client_id: string
          created_at: string
          date_of_birth: string | null
          display_name: string
          email: string | null
          email_normalized: string | null
          first_name: string | null
          id: string
          last_name: string | null
          metadata: Json
          organization_id: string
          pesel: string | null
          phone: string | null
          phone_normalized: string | null
          role: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date_of_birth?: string | null
          display_name: string
          email?: string | null
          email_normalized?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          organization_id: string
          pesel?: string | null
          phone?: string | null
          phone_normalized?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date_of_birth?: string | null
          display_name?: string
          email?: string | null
          email_normalized?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          organization_id?: string
          pesel?: string | null
          phone?: string | null
          phone_normalized?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_people_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_people_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_client_people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_clients: {
        Row: {
          created_at: string
          display_name: string
          id: string
          lead_source: string | null
          metadata: Json
          notes: string | null
          organization_id: string
          owner_user_id: string | null
          primary_email: string | null
          primary_email_normalized: string | null
          primary_phone: string | null
          primary_phone_normalized: string | null
          search_text: string
          search_vector: unknown
          status_code: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          lead_source?: string | null
          metadata?: Json
          notes?: string | null
          organization_id: string
          owner_user_id?: string | null
          primary_email?: string | null
          primary_email_normalized?: string | null
          primary_phone?: string | null
          primary_phone_normalized?: string | null
          search_text?: string
          search_vector?: unknown
          status_code?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          lead_source?: string | null
          metadata?: Json
          notes?: string | null
          organization_id?: string
          owner_user_id?: string | null
          primary_email?: string | null
          primary_email_normalized?: string | null
          primary_phone?: string | null
          primary_phone_normalized?: string | null
          search_text?: string
          search_vector?: unknown
          status_code?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_clients_organization_owner_membership_fkey"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_clients_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_consent_definition_versions: {
        Row: {
          change_note: string | null
          channel: string
          content: string
          content_sha256: string | null
          created_at: string
          created_by_user_id: string | null
          definition_id: string
          display_title: string
          effective_from: string
          effective_to: string | null
          id: string
          internal_name: string
          is_required: boolean
          language_code: string
          legal_basis: string
          organization_id: string
          purpose: string
          sort_order: number
          status: string
          version: number
        }
        Insert: {
          change_note?: string | null
          channel: string
          content: string
          content_sha256?: string | null
          created_at?: string
          created_by_user_id?: string | null
          definition_id: string
          display_title: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          internal_name: string
          is_required?: boolean
          language_code?: string
          legal_basis: string
          organization_id: string
          purpose: string
          sort_order?: number
          status?: string
          version: number
        }
        Update: {
          change_note?: string | null
          channel?: string
          content?: string
          content_sha256?: string | null
          created_at?: string
          created_by_user_id?: string | null
          definition_id?: string
          display_title?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          internal_name?: string
          is_required?: boolean
          language_code?: string
          legal_basis?: string
          organization_id?: string
          purpose?: string
          sort_order?: number
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_consent_versions_created_by_fkey"
            columns: ["organization_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_consent_versions_definition_fkey"
            columns: ["organization_id", "definition_id"]
            isOneToOne: false
            referencedRelation: "crm_consent_definitions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      crm_consent_definitions: {
        Row: {
          code: string
          context: string
          created_at: string
          created_by_user_id: string | null
          current_version_id: string
          id: string
          organization_id: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          code: string
          context?: string
          created_at?: string
          created_by_user_id?: string | null
          current_version_id: string
          id?: string
          organization_id: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          code?: string
          context?: string
          created_at?: string
          created_by_user_id?: string | null
          current_version_id?: string
          id?: string
          organization_id?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_consent_definitions_created_by_fkey"
            columns: ["organization_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_consent_definitions_current_version_fkey"
            columns: ["organization_id", "id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "crm_consent_definition_versions"
            referencedColumns: ["organization_id", "definition_id", "id"]
          },
          {
            foreignKeyName: "crm_consent_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_consent_definitions_updated_by_fkey"
            columns: ["organization_id", "updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      crm_documents: {
        Row: {
          case_id: string | null
          case_item_id: string | null
          client_id: string | null
          created_at: string
          document_type: string
          id: string
          metadata: Json
          name: string
          organization_id: string
          received_at: string | null
          status_code: string
          storage_bucket: string | null
          storage_path: string | null
          submission_id: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          case_id?: string | null
          case_item_id?: string | null
          client_id?: string | null
          created_at?: string
          document_type?: string
          id?: string
          metadata?: Json
          name: string
          organization_id: string
          received_at?: string | null
          status_code?: string
          storage_bucket?: string | null
          storage_path?: string | null
          submission_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          case_id?: string | null
          case_item_id?: string | null
          client_id?: string | null
          created_at?: string
          document_type?: string
          id?: string
          metadata?: Json
          name?: string
          organization_id?: string
          received_at?: string | null
          status_code?: string
          storage_bucket?: string | null
          storage_path?: string | null
          submission_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_case_item_id_fkey"
            columns: ["case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_documents_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_organization_item_fkey"
            columns: ["organization_id", "case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_documents_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "crm_item_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_item_submissions: {
        Row: {
          case_item_id: string
          created_at: string
          currency: string
          decision_at: string | null
          external_reference: string | null
          id: string
          metadata: Json
          notes: string | null
          offered_amount: number | null
          organization_id: string
          premium_amount: number | null
          provider_id: string | null
          status_code: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          case_item_id: string
          created_at?: string
          currency?: string
          decision_at?: string | null
          external_reference?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          offered_amount?: number | null
          organization_id: string
          premium_amount?: number | null
          provider_id?: string | null
          status_code?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          case_item_id?: string
          created_at?: string
          currency?: string
          decision_at?: string | null
          external_reference?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          offered_amount?: number | null
          organization_id?: string
          premium_amount?: number | null
          provider_id?: string | null
          status_code?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_item_submissions_case_item_id_fkey"
            columns: ["case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_item_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_item_submissions_organization_item_fkey"
            columns: ["organization_id", "case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_item_submissions_organization_provider_fkey"
            columns: ["organization_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "crm_providers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_item_submissions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "crm_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_product_types: {
        Row: {
          code: string
          created_at: string
          description: string | null
          domain: string
          id: string
          is_active: boolean
          is_system: boolean
          metadata: Json
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          metadata?: Json
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          metadata?: Json
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_product_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_properties: {
        Row: {
          address: string
          area_m2: number | null
          case_id: string | null
          case_item_id: string | null
          city: string | null
          created_at: string
          currency: string
          id: string
          market_type: string | null
          metadata: Json
          organization_id: string
          postal_code: string | null
          price_amount: number | null
          property_type: string | null
          rooms: number | null
          updated_at: string
        }
        Insert: {
          address: string
          area_m2?: number | null
          case_id?: string | null
          case_item_id?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          id?: string
          market_type?: string | null
          metadata?: Json
          organization_id: string
          postal_code?: string | null
          price_amount?: number | null
          property_type?: string | null
          rooms?: number | null
          updated_at?: string
        }
        Update: {
          address?: string
          area_m2?: number | null
          case_id?: string | null
          case_item_id?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          id?: string
          market_type?: string | null
          metadata?: Json
          organization_id?: string
          postal_code?: string | null
          price_amount?: number | null
          property_type?: string | null
          rooms?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_properties_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_properties_case_item_id_fkey"
            columns: ["case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_properties_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_providers: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          metadata: Json
          name: string
          organization_id: string
          tax_id: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          metadata?: Json
          name: string
          organization_id: string
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          metadata?: Json
          name?: string
          organization_id?: string
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assignee_user_id: string | null
          case_id: string | null
          case_item_id: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          metadata: Json
          organization_id: string
          priority: string
          status_code: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          case_id?: string | null
          case_item_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          priority?: string
          status_code?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          case_id?: string | null
          case_item_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          priority?: string
          status_code?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_case_item_id_fkey"
            columns: ["case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_organization_assignee_membership_fkey"
            columns: ["organization_id", "assignee_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "crm_tasks_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_tasks_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_organization_item_fkey"
            columns: ["organization_id", "case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      crm_workflow_statuses: {
        Row: {
          code: string
          color: string
          created_at: string
          id: string
          is_initial: boolean
          is_terminal: boolean
          label: string
          organization_id: string | null
          sort_order: number
          updated_at: string
          workflow_id: string
        }
        Insert: {
          code: string
          color?: string
          created_at?: string
          id?: string
          is_initial?: boolean
          is_terminal?: boolean
          label: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          workflow_id: string
        }
        Update: {
          code?: string
          color?: string
          created_at?: string
          id?: string
          is_initial?: boolean
          is_terminal?: boolean
          label?: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_workflow_statuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_workflow_statuses_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "crm_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_workflows: {
        Row: {
          code: string
          created_at: string
          domain: string | null
          id: string
          is_default: boolean
          is_system: boolean
          name: string
          organization_id: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          domain?: string | null
          id?: string
          is_default?: boolean
          is_system?: boolean
          name: string
          organization_id?: string | null
          scope: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          domain?: string | null
          id?: string
          is_default?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_workflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_availability_overrides: {
        Row: {
          availability_range: unknown
          created_at: string
          ends_at: string | null
          facility_id: string
          id: string
          is_unavailable: boolean
          local_date: string
          organization_id: string
          starts_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          availability_range?: unknown
          created_at?: string
          ends_at?: string | null
          facility_id: string
          id?: string
          is_unavailable?: boolean
          local_date: string
          organization_id: string
          starts_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          availability_range?: unknown
          created_at?: string
          ends_at?: string | null
          facility_id?: string
          id?: string
          is_unavailable?: boolean
          local_date?: string
          organization_id?: string
          starts_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_availability_overrides_membership_fkey"
            columns: ["organization_id", "facility_id", "user_id"]
            isOneToOne: false
            referencedRelation: "facility_memberships"
            referencedColumns: ["organization_id", "facility_id", "user_id"]
          },
        ]
      }
      expert_availability_rules: {
        Row: {
          availability_range: unknown
          created_at: string
          ends_at: string
          facility_id: string
          id: string
          is_active: boolean
          organization_id: string
          starts_at: string
          updated_at: string
          user_id: string
          valid_from: string | null
          valid_until: string | null
          weekday: number
        }
        Insert: {
          availability_range?: unknown
          created_at?: string
          ends_at: string
          facility_id: string
          id?: string
          is_active?: boolean
          organization_id: string
          starts_at: string
          updated_at?: string
          user_id: string
          valid_from?: string | null
          valid_until?: string | null
          weekday: number
        }
        Update: {
          availability_range?: unknown
          created_at?: string
          ends_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          starts_at?: string
          updated_at?: string
          user_id?: string
          valid_from?: string | null
          valid_until?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "expert_availability_rules_membership_fkey"
            columns: ["organization_id", "facility_id", "user_id"]
            isOneToOne: false
            referencedRelation: "facility_memberships"
            referencedColumns: ["organization_id", "facility_id", "user_id"]
          },
        ]
      }
      external_busy_blocks: {
        Row: {
          busy_period: unknown
          calendar_id: string
          connection_id: string
          created_at: string
          external_event_id: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          busy_period: unknown
          calendar_id: string
          connection_id: string
          created_at?: string
          external_event_id: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          busy_period?: unknown
          calendar_id?: string
          connection_id?: string
          created_at?: string
          external_event_id?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_busy_blocks_connection_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      facilities: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country_code: string
          created_at: string
          description: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          phone: string | null
          postal_code: string | null
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_memberships: {
        Row: {
          booking_priority: number
          created_at: string
          facility_id: string
          is_bookable: boolean
          last_assigned_at: string | null
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_priority?: number
          created_at?: string
          facility_id: string
          is_bookable?: boolean
          last_assigned_at?: string | null
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_priority?: number
          created_at?: string
          facility_id?: string
          is_bookable?: boolean
          last_assigned_at?: string | null
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_memberships_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "facility_memberships_organization_member_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      facility_opening_hours: {
        Row: {
          closes_at: string
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          opening_range: unknown
          opens_at: string
          organization_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          closes_at: string
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          opening_range?: unknown
          opens_at: string
          organization_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          closes_at?: string
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          opening_range?: unknown
          opens_at?: string
          organization_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "facility_opening_hours_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      facility_opening_overrides: {
        Row: {
          closes_at: string | null
          created_at: string
          facility_id: string
          id: string
          is_closed: boolean
          local_date: string
          opening_range: unknown
          opens_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_closed?: boolean
          local_date: string
          opening_range?: unknown
          opens_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_closed?: boolean
          local_date?: string
          opening_range?: unknown
          opens_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_opening_overrides_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      facility_service_experts: {
        Row: {
          created_at: string
          facility_id: string
          is_active: boolean
          organization_id: string
          service_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          is_active?: boolean
          organization_id: string
          service_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          is_active?: boolean
          organization_id?: string
          service_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_service_experts_membership_fkey"
            columns: ["organization_id", "facility_id", "user_id"]
            isOneToOne: false
            referencedRelation: "facility_memberships"
            referencedColumns: ["organization_id", "facility_id", "user_id"]
          },
          {
            foreignKeyName: "facility_service_experts_service_fkey"
            columns: ["organization_id", "facility_id", "service_id"]
            isOneToOne: false
            referencedRelation: "facility_services"
            referencedColumns: ["organization_id", "facility_id", "service_id"]
          },
        ]
      }
      facility_services: {
        Row: {
          created_at: string
          facility_id: string
          is_active: boolean
          organization_id: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          is_active?: boolean
          organization_id: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          is_active?: boolean
          organization_id?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_services_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "facility_services_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      mortgage_bank_override_revisions: {
        Row: {
          action: string
          bank_id: string
          changed_by: string
          created_at: string
          custom_name: string | null
          custom_website_url: string | null
          id: string
          is_enabled: boolean
          logo_path: string | null
          notes: string | null
          organization_id: string
          override_id: string | null
          revision: number
        }
        Insert: {
          action: string
          bank_id: string
          changed_by: string
          created_at?: string
          custom_name?: string | null
          custom_website_url?: string | null
          id?: string
          is_enabled: boolean
          logo_path?: string | null
          notes?: string | null
          organization_id: string
          override_id?: string | null
          revision: number
        }
        Update: {
          action?: string
          bank_id?: string
          changed_by?: string
          created_at?: string
          custom_name?: string | null
          custom_website_url?: string | null
          id?: string
          is_enabled?: boolean
          logo_path?: string | null
          notes?: string | null
          organization_id?: string
          override_id?: string | null
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_bank_override_revisions_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_bank_override_revisions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_bank_override_revisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_bank_override_revisions_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "mortgage_bank_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_bank_overrides: {
        Row: {
          bank_id: string
          created_at: string
          created_by: string
          custom_name: string | null
          custom_website_url: string | null
          id: string
          is_enabled: boolean
          logo_path: string | null
          notes: string | null
          organization_id: string
          revision: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          bank_id: string
          created_at?: string
          created_by: string
          custom_name?: string | null
          custom_website_url?: string | null
          id?: string
          is_enabled?: boolean
          logo_path?: string | null
          notes?: string | null
          organization_id: string
          revision?: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          bank_id?: string
          created_at?: string
          created_by?: string
          custom_name?: string | null
          custom_website_url?: string | null
          id?: string
          is_enabled?: boolean
          logo_path?: string | null
          notes?: string | null
          organization_id?: string
          revision?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_bank_overrides_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_bank_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_bank_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_bank_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_banks: {
        Row: {
          created_at: string
          id: string
          logo_background_color: string | null
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_background_color?: string | null
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_background_color?: string | null
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
          website_url?: string
        }
        Relationships: []
      }
      mortgage_capacity_setting_revisions: {
        Row: {
          action: string
          changed_by: string
          created_at: string
          id: string
          organization_id: string
          revision: number
          settings: Json
        }
        Insert: {
          action: string
          changed_by: string
          created_at?: string
          id?: string
          organization_id: string
          revision: number
          settings: Json
        }
        Update: {
          action?: string
          changed_by?: string
          created_at?: string
          id?: string
          organization_id?: string
          revision?: number
          settings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_capacity_setting_revisions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_capacity_setting_revisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_capacity_settings: {
        Row: {
          created_at: string
          created_by: string
          credit_limit_monthly_charge_pct: number
          default_fixed_rate_period_months: number
          default_interest_rate_pct: number
          default_interest_type: string
          dsti_limit_pct: number
          income_buffer_pct: number
          max_ltv_pct: number
          minimum_social_1_person: number
          minimum_social_2_people: number
          minimum_social_3_people: number
          minimum_social_4_people: number
          minimum_social_5_people: number
          minimum_social_additional_person: number
          minimum_social_as_of: string
          nbp_reference_rate_as_of: string
          nbp_reference_rate_pct: number
          notes: string | null
          organization_id: string
          policy_as_of: string
          revision: number
          updated_at: string
          updated_by: string
          variable_rate_volatility_buffer_pct: number
        }
        Insert: {
          created_at?: string
          created_by: string
          credit_limit_monthly_charge_pct: number
          default_fixed_rate_period_months: number
          default_interest_rate_pct: number
          default_interest_type: string
          dsti_limit_pct: number
          income_buffer_pct: number
          max_ltv_pct: number
          minimum_social_1_person: number
          minimum_social_2_people: number
          minimum_social_3_people: number
          minimum_social_4_people: number
          minimum_social_5_people: number
          minimum_social_additional_person: number
          minimum_social_as_of: string
          nbp_reference_rate_as_of: string
          nbp_reference_rate_pct: number
          notes?: string | null
          organization_id: string
          policy_as_of: string
          revision?: number
          updated_at?: string
          updated_by: string
          variable_rate_volatility_buffer_pct: number
        }
        Update: {
          created_at?: string
          created_by?: string
          credit_limit_monthly_charge_pct?: number
          default_fixed_rate_period_months?: number
          default_interest_rate_pct?: number
          default_interest_type?: string
          dsti_limit_pct?: number
          income_buffer_pct?: number
          max_ltv_pct?: number
          minimum_social_1_person?: number
          minimum_social_2_people?: number
          minimum_social_3_people?: number
          minimum_social_4_people?: number
          minimum_social_5_people?: number
          minimum_social_additional_person?: number
          minimum_social_as_of?: string
          nbp_reference_rate_as_of?: string
          nbp_reference_rate_pct?: number
          notes?: string | null
          organization_id?: string
          policy_as_of?: string
          revision?: number
          updated_at?: string
          updated_by?: string
          variable_rate_volatility_buffer_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_capacity_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_capacity_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_capacity_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_override_revisions: {
        Row: {
          action: string
          changed_by: string
          created_at: string
          custom_name: string | null
          id: string
          is_enabled: boolean
          notes: string | null
          organization_id: string
          override_id: string | null
          parameters: Json
          product_id: string
          revision: number
        }
        Insert: {
          action: string
          changed_by: string
          created_at?: string
          custom_name?: string | null
          id?: string
          is_enabled: boolean
          notes?: string | null
          organization_id: string
          override_id?: string | null
          parameters: Json
          product_id: string
          revision: number
        }
        Update: {
          action?: string
          changed_by?: string
          created_at?: string
          custom_name?: string | null
          id?: string
          is_enabled?: boolean
          notes?: string | null
          organization_id?: string
          override_id?: string | null
          parameters?: Json
          product_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_override_revisions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_override_revisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_override_revisions_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_overrides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_override_revisions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_overrides: {
        Row: {
          created_at: string
          created_by: string
          custom_name: string | null
          id: string
          is_enabled: boolean
          notes: string | null
          organization_id: string
          parameters: Json
          product_id: string
          revision: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          custom_name?: string | null
          id?: string
          is_enabled?: boolean
          notes?: string | null
          organization_id: string
          parameters?: Json
          product_id: string
          revision?: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          custom_name?: string | null
          id?: string
          is_enabled?: boolean
          notes?: string | null
          organization_id?: string
          parameters?: Json
          product_id?: string
          revision?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_versions: {
        Row: {
          assumptions: Json
          calculation_date: string | null
          completeness_score: number
          cost_rules: Json
          created_at: string
          data_status: string
          effective_from: string | null
          effective_to: string | null
          fixed_period_months: number | null
          fixed_rate_pct: number | null
          id: string
          interest_type: string
          is_eco: boolean
          margin_pct: number | null
          max_amount: number | null
          max_ltv_pct: number | null
          max_term_months: number | null
          min_amount: number | null
          min_term_months: number | null
          product_id: string
          reference_rate_as_of: string | null
          reference_rate_code: string | null
          reference_rate_pct: number | null
          representative_apr_pct: number | null
          representative_example: Json
          requirements: Json
          retrieved_at: string
          source_document_id: string | null
          unknown_fields: string[]
          updated_at: string
          version_key: string
        }
        Insert: {
          assumptions?: Json
          calculation_date?: string | null
          completeness_score: number
          cost_rules?: Json
          created_at?: string
          data_status: string
          effective_from?: string | null
          effective_to?: string | null
          fixed_period_months?: number | null
          fixed_rate_pct?: number | null
          id?: string
          interest_type: string
          is_eco?: boolean
          margin_pct?: number | null
          max_amount?: number | null
          max_ltv_pct?: number | null
          max_term_months?: number | null
          min_amount?: number | null
          min_term_months?: number | null
          product_id: string
          reference_rate_as_of?: string | null
          reference_rate_code?: string | null
          reference_rate_pct?: number | null
          representative_apr_pct?: number | null
          representative_example?: Json
          requirements?: Json
          retrieved_at: string
          source_document_id?: string | null
          unknown_fields?: string[]
          updated_at?: string
          version_key: string
        }
        Update: {
          assumptions?: Json
          calculation_date?: string | null
          completeness_score?: number
          cost_rules?: Json
          created_at?: string
          data_status?: string
          effective_from?: string | null
          effective_to?: string | null
          fixed_period_months?: number | null
          fixed_rate_pct?: number | null
          id?: string
          interest_type?: string
          is_eco?: boolean
          margin_pct?: number | null
          max_amount?: number | null
          max_ltv_pct?: number | null
          max_term_months?: number | null
          min_amount?: number | null
          min_term_months?: number | null
          product_id?: string
          reference_rate_as_of?: string | null
          reference_rate_code?: string | null
          reference_rate_pct?: number | null
          representative_apr_pct?: number | null
          representative_example?: Json
          requirements?: Json
          retrieved_at?: string
          source_document_id?: string | null
          unknown_fields?: string[]
          updated_at?: string
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_versions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "mortgage_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_products: {
        Row: {
          bank_id: string
          category: string
          created_at: string
          distribution_channel: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          bank_id: string
          category?: string
          created_at?: string
          distribution_channel?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          bank_id?: string
          category?: string
          created_at?: string
          distribution_channel?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_products_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_source_documents: {
        Row: {
          bank_id: string
          created_at: string
          error_message: string | null
          extraction_status: string
          facts: Json
          id: string
          mime_type: string | null
          product_id: string | null
          published_at: string | null
          retrieval_status: string
          retrieved_at: string
          sha256: string | null
          source_key: string
          source_kind: string
          source_url: string
          storage_path: string | null
          title: string
          updated_at: string
        }
        Insert: {
          bank_id: string
          created_at?: string
          error_message?: string | null
          extraction_status?: string
          facts?: Json
          id?: string
          mime_type?: string | null
          product_id?: string | null
          published_at?: string | null
          retrieval_status?: string
          retrieved_at: string
          sha256?: string | null
          source_key: string
          source_kind: string
          source_url: string
          storage_path?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          bank_id?: string
          created_at?: string
          error_message?: string | null
          extraction_status?: string
          facts?: Json
          id?: string
          mime_type?: string | null
          product_id?: string | null
          published_at?: string | null
          retrieval_status?: string
          retrieved_at?: string
          sha256?: string | null
          source_key?: string
          source_kind?: string
          source_url?: string
          storage_path?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_source_documents_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_source_documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_design_settings: {
        Row: {
          created_at: string
          organization_id: string
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          organization_id: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          organization_id?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_design_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_design_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      team_edges: {
        Row: {
          child_team_id: string
          created_at: string
          organization_id: string
          parent_team_id: string
        }
        Insert: {
          child_team_id: string
          created_at?: string
          organization_id: string
          parent_team_id: string
        }
        Update: {
          child_team_id?: string
          created_at?: string
          organization_id?: string
          parent_team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_edges_child_fkey"
            columns: ["organization_id", "child_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "team_edges_parent_fkey"
            columns: ["organization_id", "parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      team_facilities: {
        Row: {
          created_at: string
          facility_id: string
          organization_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          organization_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          organization_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_facilities_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "team_facilities_team_fkey"
            columns: ["organization_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_organization_member_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "team_memberships_team_fkey"
            columns: ["organization_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          organization_id: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          organization_id: string
          role?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_default_organization_membership_fkey"
            columns: ["organization_id", "id", "role"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id", "role"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          survey_completed_at: string | null
          survey_contrib: string | null
          survey_domain: string[] | null
          survey_notes: string | null
          survey_priority: string | null
          survey_token: string
          survey_usecase: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          survey_completed_at?: string | null
          survey_contrib?: string | null
          survey_domain?: string[] | null
          survey_notes?: string | null
          survey_priority?: string | null
          survey_token?: string
          survey_usecase?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          survey_completed_at?: string | null
          survey_contrib?: string | null
          survey_domain?: string[] | null
          survey_notes?: string | null
          survey_priority?: string | null
          survey_token?: string
          survey_usecase?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_organization_member_by_email: {
        Args: { email: string; organization_id: string; role?: string }
        Returns: {
          created_at: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "organization_memberships"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      add_team_edge: {
        Args: {
          child_team_id: string
          organization_id: string
          parent_team_id: string
        }
        Returns: {
          child_team_id: string
          created_at: string
          organization_id: string
          parent_team_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "team_edges"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_booking_rate_limit: {
        Args: {
          p_client_key: string
          p_limit: number
          p_scope: string
          p_widget_token: string
          p_window_seconds: number
        }
        Returns: number
      }
      create_crm_client_with_consents: {
        Args: {
          p_consent_decisions: Json
          p_display_name: string
          p_lead_source: string
          p_metadata: Json
          p_notes: string
          p_organization_id: string
          p_owner_user_id: string
          p_primary_email: string
          p_primary_person: Json
          p_primary_phone: string
          p_status_code: string
          p_tags: string[]
        }
        Returns: Json
      }
      create_crm_consent_definition: {
        Args: {
          p_change_note?: string
          p_channel: string
          p_code: string
          p_content: string
          p_display_title: string
          p_effective_from: string
          p_effective_to: string
          p_internal_name: string
          p_is_required: boolean
          p_language_code: string
          p_legal_basis: string
          p_organization_id: string
          p_purpose: string
          p_sort_order: number
          p_status: string
        }
        Returns: string
      }
      create_staff_appointment: {
        Args: {
          p_client_id: string
          p_client_person_id: string
          p_created_by_user_id: string
          p_expert_user_id: string
          p_facility_id: string
          p_idempotency_key: string
          p_notes: string
          p_organization_id: string
          p_service_id: string
          p_starts_at: string
        }
        Returns: Json
      }
      create_widget_booking: {
        Args: {
          p_booking_context: Json
          p_consent_decisions: Json
          p_customer_email: string
          p_customer_name: string
          p_customer_phone: string
          p_expert_user_id: string
          p_idempotency_key: string
          p_notes: string
          p_request_fingerprint: string
          p_service_id: string
          p_starts_at: string
          p_widget_token: string
        }
        Returns: Json
      }
      get_booking_widget_catalog: {
        Args: { p_widget_token: string }
        Returns: Json
      }
      get_booking_widget_slots: {
        Args: {
          p_ends_on: string
          p_expert_user_id?: string
          p_service_id: string
          p_starts_on: string
          p_widget_token: string
        }
        Returns: {
          ends_at: string
          expert_name: string
          expert_user_id: string
          starts_at: string
        }[]
      }
      get_staff_booking_slots: {
        Args: {
          p_expert_user_id?: string
          p_facility_id: string
          p_local_date: string
          p_organization_id: string
          p_service_id: string
        }
        Returns: {
          ends_at: string
          expert_name: string
          expert_user_id: string
          starts_at: string
        }[]
      }
      replace_calendar_busy_blocks: {
        Args: {
          p_blocks: Json
          p_connection_id: string
          p_organization_id: string
        }
        Returns: number
      }
      replace_expert_availability: {
        Args: {
          p_facility_id: string
          p_organization_id: string
          p_overrides: Json
          p_rules: Json
          p_user_id: string
        }
        Returns: undefined
      }
      replace_facility_opening_hours: {
        Args: {
          p_facility_id: string
          p_hours: Json
          p_organization_id: string
          p_overrides: Json
        }
        Returns: undefined
      }
      replay_widget_booking: {
        Args: {
          p_idempotency_key: string
          p_request_fingerprint: string
          p_widget_token: string
        }
        Returns: Json
      }
      search_crm_clients: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      update_booking_widget_configuration: {
        Args: {
          p_facility_id: string
          p_organization_id: string
          p_service_ids: string[]
          p_update_services: boolean
          p_widget_id: string
          p_widget_patch: Json
        }
        Returns: undefined
      }
      update_crm_consent_definition: {
        Args: {
          p_change_note?: string
          p_channel: string
          p_content: string
          p_definition_id: string
          p_display_title: string
          p_effective_from: string
          p_effective_to: string
          p_internal_name: string
          p_is_required: boolean
          p_language_code: string
          p_legal_basis: string
          p_organization_id: string
          p_purpose: string
          p_sort_order: number
          p_status: string
        }
        Returns: string
      }
      update_facility_service_configuration: {
        Args: {
          p_expert_user_ids: string[]
          p_facility_id: string
          p_is_available: boolean
          p_organization_id: string
          p_service_id: string
          p_service_patch: Json
          p_update_availability: boolean
          p_update_experts: boolean
        }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

