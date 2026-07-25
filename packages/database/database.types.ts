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
          appointment_id: string | null
          busy_period: unknown
          created_at: string
          hold_expires_at: string | null
          id: string
          organization_id: string
          resource_id: string
          resource_type: string
          status: string
          time_off_id: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          busy_period: unknown
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          organization_id: string
          resource_id: string
          resource_type: string
          status: string
          time_off_id?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          busy_period?: unknown
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          organization_id?: string
          resource_id?: string
          resource_type?: string
          status?: string
          time_off_id?: string | null
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
          {
            foreignKeyName: "appointment_resource_reservations_time_off_fkey"
            columns: ["organization_id", "time_off_id"]
            isOneToOne: false
            referencedRelation: "expert_time_off"
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
          meeting_mode: string
          meeting_url: string | null
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
          meeting_mode?: string
          meeting_url?: string | null
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
          meeting_mode?: string
          meeting_url?: string | null
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
      booking_widget_events: {
        Row: {
          event_id: string | null
          event_type: string
          facility_id: string
          id: number
          is_embedded: boolean
          occurred_at: string
          organization_id: string
          service_id: string | null
          visit_id: string
          widget_id: string
        }
        Insert: {
          event_id?: string | null
          event_type: string
          facility_id: string
          id?: never
          is_embedded?: boolean
          occurred_at?: string
          organization_id: string
          service_id?: string | null
          visit_id: string
          widget_id: string
        }
        Update: {
          event_id?: string | null
          event_type?: string
          facility_id?: string
          id?: never
          is_embedded?: boolean
          occurred_at?: string
          organization_id?: string
          service_id?: string | null
          visit_id?: string
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_widget_events_service_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "booking_widget_events_widget_fkey"
            columns: ["organization_id", "facility_id", "widget_id"]
            isOneToOne: false
            referencedRelation: "booking_widgets"
            referencedColumns: ["organization_id", "facility_id", "id"]
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
          analytics_started_at: string
          booking_mode: string
          created_at: string
          created_by_user_id: string | null
          facility_id: string
          fixed_expert_user_id: string | null
          id: string
          is_active: boolean
          is_directory_listed: boolean
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
          analytics_started_at?: string
          booking_mode?: string
          created_at?: string
          created_by_user_id?: string | null
          facility_id: string
          fixed_expert_user_id?: string | null
          id?: string
          is_active?: boolean
          is_directory_listed?: boolean
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
          analytics_started_at?: string
          booking_mode?: string
          created_at?: string
          created_by_user_id?: string | null
          facility_id?: string
          fixed_expert_user_id?: string | null
          id?: string
          is_active?: boolean
          is_directory_listed?: boolean
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
      client_account_links: {
        Row: {
          auth_user_id: string
          client_id: string
          client_person_id: string
          created_at: string
          organization_id: string
          revoked_at: string | null
          source_appointment_id: string | null
          verification_method: string
          verified_at: string
          verified_contact_normalized: string
        }
        Insert: {
          auth_user_id: string
          client_id: string
          client_person_id: string
          created_at?: string
          organization_id: string
          revoked_at?: string | null
          source_appointment_id?: string | null
          verification_method: string
          verified_at: string
          verified_contact_normalized: string
        }
        Update: {
          auth_user_id?: string
          client_id?: string
          client_person_id?: string
          created_at?: string
          organization_id?: string
          revoked_at?: string | null
          source_appointment_id?: string | null
          verification_method?: string
          verified_at?: string
          verified_contact_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_account_links_appointment_fkey"
            columns: ["organization_id", "source_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_account_links_auth_user_id_fkey"
            columns: ["auth_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_account_links_person_fkey"
            columns: ["organization_id", "client_id", "client_person_id"]
            isOneToOne: false
            referencedRelation: "crm_client_people"
            referencedColumns: ["organization_id", "client_id", "id"]
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
      crm_case_bank_applications: {
        Row: {
          appraisal_value_amount: number | null
          bank_id: string
          calculated_at: string | null
          calculation_snapshot: Json | null
          calculator_version: string | null
          case_id: string
          case_item_id: string
          collateral_value_amount: number | null
          collateral_value_basis: string | null
          comparison_baseline_offer_id: string | null
          cost_first_five_years: number | null
          created_at: string
          created_by_user_id: string | null
          financed_costs: number | null
          first_installment: number | null
          first_monthly_outflow: number | null
          gross_loan_amount: number | null
          ltv_debt_amount: number | null
          ltv_debt_basis: string | null
          ltv_pct: number | null
          net_loan_amount: number | null
          offer_id: string
          organization_id: string
          property_id: string | null
          purchase_price_amount: number | null
          scenario_snapshot: Json | null
          slot: number
          snapshot_schema_version: string | null
          snapshot_status: string
          submission_id: string
          total_cost: number | null
        }
        Insert: {
          appraisal_value_amount?: number | null
          bank_id: string
          calculated_at?: string | null
          calculation_snapshot?: Json | null
          calculator_version?: string | null
          case_id: string
          case_item_id: string
          collateral_value_amount?: number | null
          collateral_value_basis?: string | null
          comparison_baseline_offer_id?: string | null
          cost_first_five_years?: number | null
          created_at?: string
          created_by_user_id?: string | null
          financed_costs?: number | null
          first_installment?: number | null
          first_monthly_outflow?: number | null
          gross_loan_amount?: number | null
          ltv_debt_amount?: number | null
          ltv_debt_basis?: string | null
          ltv_pct?: number | null
          net_loan_amount?: number | null
          offer_id: string
          organization_id: string
          property_id?: string | null
          purchase_price_amount?: number | null
          scenario_snapshot?: Json | null
          slot: number
          snapshot_schema_version?: string | null
          snapshot_status?: string
          submission_id: string
          total_cost?: number | null
        }
        Update: {
          appraisal_value_amount?: number | null
          bank_id?: string
          calculated_at?: string | null
          calculation_snapshot?: Json | null
          calculator_version?: string | null
          case_id?: string
          case_item_id?: string
          collateral_value_amount?: number | null
          collateral_value_basis?: string | null
          comparison_baseline_offer_id?: string | null
          cost_first_five_years?: number | null
          created_at?: string
          created_by_user_id?: string | null
          financed_costs?: number | null
          first_installment?: number | null
          first_monthly_outflow?: number | null
          gross_loan_amount?: number | null
          ltv_debt_amount?: number | null
          ltv_debt_basis?: string | null
          ltv_pct?: number | null
          net_loan_amount?: number | null
          offer_id?: string
          organization_id?: string
          property_id?: string | null
          purchase_price_amount?: number | null
          scenario_snapshot?: Json | null
          slot?: number
          snapshot_schema_version?: string | null
          snapshot_status?: string
          submission_id?: string
          total_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_bank_applications_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_baseline_offer_fkey"
            columns: [
              "organization_id",
              "case_id",
              "comparison_baseline_offer_id",
            ]
            isOneToOne: false
            referencedRelation: "crm_case_offer_snapshots"
            referencedColumns: ["organization_id", "case_id", "id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_case_item_fkey"
            columns: ["organization_id", "case_item_id"]
            isOneToOne: false
            referencedRelation: "crm_case_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_case_offer_bank_fkey"
            columns: ["organization_id", "case_id", "offer_id", "bank_id"]
            isOneToOne: false
            referencedRelation: "crm_case_offer_snapshots"
            referencedColumns: ["organization_id", "case_id", "id", "bank_id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_case_property_fkey"
            columns: ["organization_id", "case_id", "property_id"]
            isOneToOne: false
            referencedRelation: "crm_properties"
            referencedColumns: ["organization_id", "case_id", "id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_bank_applications_submission_item_fkey"
            columns: ["organization_id", "case_item_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "crm_item_submissions"
            referencedColumns: ["organization_id", "case_item_id", "id"]
          },
        ]
      }
      crm_case_clients: {
        Row: {
          case_id: string
          client_id: string
          created_at: string
          id: string
          is_primary: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          case_id: string
          client_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          client_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_clients_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_clients_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_case_contract_selections: {
        Row: {
          application_id: string
          case_id: string
          organization_id: string
          signed_at: string
          signed_by_user_id: string
        }
        Insert: {
          application_id: string
          case_id: string
          organization_id: string
          signed_at?: string
          signed_by_user_id: string
        }
        Update: {
          application_id?: string
          case_id?: string
          organization_id?: string
          signed_at?: string
          signed_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_contract_selections_application_fkey"
            columns: ["organization_id", "case_id", "application_id"]
            isOneToOne: false
            referencedRelation: "crm_case_bank_applications"
            referencedColumns: ["organization_id", "case_id", "submission_id"]
          },
          {
            foreignKeyName: "crm_case_contract_selections_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: true
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_contract_selections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_contract_selections_signed_by_user_id_fkey"
            columns: ["signed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      crm_case_offer_selections: {
        Row: {
          case_id: string
          offer_id: string
          organization_id: string
          selected_at: string
          selected_by_user_id: string | null
        }
        Insert: {
          case_id: string
          offer_id: string
          organization_id: string
          selected_at?: string
          selected_by_user_id?: string | null
        }
        Update: {
          case_id?: string
          offer_id?: string
          organization_id?: string
          selected_at?: string
          selected_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_offer_selections_case_offer_fkey"
            columns: ["organization_id", "case_id", "offer_id"]
            isOneToOne: false
            referencedRelation: "crm_case_offer_snapshots"
            referencedColumns: ["organization_id", "case_id", "id"]
          },
          {
            foreignKeyName: "crm_case_offer_selections_focused_application_fkey"
            columns: ["organization_id", "case_id", "offer_id"]
            isOneToOne: false
            referencedRelation: "crm_case_bank_applications"
            referencedColumns: ["organization_id", "case_id", "offer_id"]
          },
          {
            foreignKeyName: "crm_case_offer_selections_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: true
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_offer_selections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_offer_selections_selected_by_user_id_fkey"
            columns: ["selected_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_case_offer_snapshots: {
        Row: {
          bank_id: string | null
          bank_name: string
          calculation_snapshot: Json
          calculator_version: string
          case_id: string
          catalog_snapshot: Json
          cost_first_five_years: number | null
          currency: string
          first_installment: number | null
          first_monthly_outflow: number | null
          id: string
          loan_amount: number | null
          mortgage_product_id: string | null
          mortgage_product_version_id: string | null
          offer_type: string
          organization_id: string
          product_name: string
          representative_apr_pct: number | null
          saved_at: string
          saved_by_user_id: string | null
          scenario_snapshot: Json
          stress_snapshot: Json | null
          total_cost: number | null
          version_key: string | null
        }
        Insert: {
          bank_id?: string | null
          bank_name: string
          calculation_snapshot: Json
          calculator_version: string
          case_id: string
          catalog_snapshot: Json
          cost_first_five_years?: number | null
          currency?: string
          first_installment?: number | null
          first_monthly_outflow?: number | null
          id?: string
          loan_amount?: number | null
          mortgage_product_id?: string | null
          mortgage_product_version_id?: string | null
          offer_type?: string
          organization_id: string
          product_name: string
          representative_apr_pct?: number | null
          saved_at?: string
          saved_by_user_id?: string | null
          scenario_snapshot: Json
          stress_snapshot?: Json | null
          total_cost?: number | null
          version_key?: string | null
        }
        Update: {
          bank_id?: string | null
          bank_name?: string
          calculation_snapshot?: Json
          calculator_version?: string
          case_id?: string
          catalog_snapshot?: Json
          cost_first_five_years?: number | null
          currency?: string
          first_installment?: number | null
          first_monthly_outflow?: number | null
          id?: string
          loan_amount?: number | null
          mortgage_product_id?: string | null
          mortgage_product_version_id?: string | null
          offer_type?: string
          organization_id?: string
          product_name?: string
          representative_apr_pct?: number | null
          saved_at?: string
          saved_by_user_id?: string | null
          scenario_snapshot?: Json
          stress_snapshot?: Json | null
          total_cost?: number | null
          version_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_offer_snapshots_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_offer_snapshots_mortgage_product_id_fkey"
            columns: ["mortgage_product_id"]
            isOneToOne: false
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_offer_snapshots_mortgage_product_version_id_fkey"
            columns: ["mortgage_product_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_offer_snapshots_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_offer_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_offer_snapshots_saved_by_user_id_fkey"
            columns: ["saved_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      crm_case_property_selections: {
        Row: {
          case_id: string
          organization_id: string
          property_id: string
          selected_at: string
          selected_by_user_id: string | null
        }
        Insert: {
          case_id: string
          organization_id: string
          property_id: string
          selected_at?: string
          selected_by_user_id?: string | null
        }
        Update: {
          case_id?: string
          organization_id?: string
          property_id?: string
          selected_at?: string
          selected_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_case_property_selections_case_property_fkey"
            columns: ["organization_id", "case_id", "property_id"]
            isOneToOne: false
            referencedRelation: "crm_properties"
            referencedColumns: ["organization_id", "case_id", "id"]
          },
          {
            foreignKeyName: "crm_case_property_selections_organization_case_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: true
            referencedRelation: "crm_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_case_property_selections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_case_property_selections_selected_by_user_id_fkey"
            columns: ["selected_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          search_text: string
          search_vector: unknown
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
          search_text?: string
          search_vector?: unknown
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
          search_text?: string
          search_vector?: unknown
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
          mime_type: string | null
          name: string
          organization_id: string
          received_at: string | null
          sha256: string | null
          size_bytes: number | null
          status_code: string
          storage_bucket: string | null
          storage_path: string | null
          submission_id: string | null
          updated_at: string
          uploaded_by_user_id: string | null
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
          mime_type?: string | null
          name: string
          organization_id: string
          received_at?: string | null
          sha256?: string | null
          size_bytes?: number | null
          status_code?: string
          storage_bucket?: string | null
          storage_path?: string | null
          submission_id?: string | null
          updated_at?: string
          uploaded_by_user_id?: string | null
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
          mime_type?: string | null
          name?: string
          organization_id?: string
          received_at?: string | null
          sha256?: string | null
          size_bytes?: number | null
          status_code?: string
          storage_bucket?: string | null
          storage_path?: string | null
          submission_id?: string | null
          updated_at?: string
          uploaded_by_user_id?: string | null
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
            foreignKeyName: "crm_documents_organization_submission_fkey"
            columns: ["organization_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "crm_item_submissions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_documents_organization_uploader_membership_fkey"
            columns: ["organization_id", "uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
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
      crm_eve_sessions: {
        Row: {
          created_at: string
          organization_id: string
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_eve_sessions_organization_member_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
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
          appraisal_value_amount: number | null
          area_m2: number | null
          case_id: string | null
          case_item_id: string | null
          city: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          imported_at: string | null
          listing_title: string | null
          market_type: string | null
          metadata: Json
          organization_id: string
          postal_code: string | null
          price_amount: number | null
          property_type: string | null
          rooms: number | null
          source_published_at: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          address: string
          appraisal_value_amount?: number | null
          area_m2?: number | null
          case_id?: string | null
          case_item_id?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          imported_at?: string | null
          listing_title?: string | null
          market_type?: string | null
          metadata?: Json
          organization_id: string
          postal_code?: string | null
          price_amount?: number | null
          property_type?: string | null
          rooms?: number | null
          source_published_at?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          appraisal_value_amount?: number | null
          area_m2?: number | null
          case_id?: string | null
          case_item_id?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          imported_at?: string | null
          listing_title?: string | null
          market_type?: string | null
          metadata?: Json
          organization_id?: string
          postal_code?: string | null
          price_amount?: number | null
          property_type?: string | null
          rooms?: number | null
          source_published_at?: string | null
          source_url?: string | null
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
      crm_property_images: {
        Row: {
          alt_text: string | null
          case_id: string
          created_at: string
          height_px: number | null
          id: string
          metadata: Json
          mime_type: string
          organization_id: string
          property_id: string
          sha256: string
          size_bytes: number
          sort_order: number
          source_url: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          width_px: number | null
        }
        Insert: {
          alt_text?: string | null
          case_id: string
          created_at?: string
          height_px?: number | null
          id?: string
          metadata?: Json
          mime_type: string
          organization_id: string
          property_id: string
          sha256: string
          size_bytes: number
          sort_order?: number
          source_url?: string | null
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          width_px?: number | null
        }
        Update: {
          alt_text?: string | null
          case_id?: string
          created_at?: string
          height_px?: number | null
          id?: string
          metadata?: Json
          mime_type?: string
          organization_id?: string
          property_id?: string
          sha256?: string
          size_bytes?: number
          sort_order?: number
          source_url?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_property_images_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "crm_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_property_images_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_property_images_property_fkey"
            columns: ["organization_id", "case_id", "property_id"]
            isOneToOne: false
            referencedRelation: "crm_properties"
            referencedColumns: ["organization_id", "case_id", "id"]
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
      expert_time_off: {
        Row: {
          all_day: boolean
          cancelled_at: string | null
          created_at: string
          created_by_user_id: string
          ends_at: string
          expert_user_id: string
          id: string
          kind: string
          notes: string | null
          organization_id: string
          starts_at: string
          status: string
          time_off_period: unknown
          timezone: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by_user_id: string
          ends_at: string
          expert_user_id: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id: string
          starts_at: string
          status?: string
          time_off_period?: unknown
          timezone: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by_user_id?: string
          ends_at?: string
          expert_user_id?: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string
          starts_at?: string
          status?: string
          time_off_period?: unknown
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_time_off_creator_membership_fkey"
            columns: ["organization_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "expert_time_off_expert_membership_fkey"
            columns: ["organization_id", "expert_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
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
      facility_images: {
        Row: {
          alt_text: string | null
          created_at: string
          facility_id: string
          height_px: number
          id: string
          mime_type: string
          organization_id: string
          original_filename: string
          sha256: string
          size_bytes: number
          sort_order: number
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_by: string
          width_px: number
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          facility_id: string
          height_px: number
          id?: string
          mime_type?: string
          organization_id: string
          original_filename: string
          sha256: string
          size_bytes: number
          sort_order?: number
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_by: string
          width_px: number
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          facility_id?: string
          height_px?: number
          id?: string
          mime_type?: string
          organization_id?: string
          original_filename?: string
          sha256?: string
          size_bytes?: number
          sort_order?: number
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "facility_images_facility_fkey"
            columns: ["organization_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "facility_images_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_images_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      mortgage_catalog_events: {
        Row: {
          actor_user_id: string | null
          bank_id: string | null
          content_sha256_after: string | null
          content_sha256_before: string | null
          created_at: string
          draft_id: string | null
          event_type: string
          id: string
          metadata: Json
          product_id: string | null
          product_version_id: string | null
          revision_after: number | null
          revision_before: number | null
        }
        Insert: {
          actor_user_id?: string | null
          bank_id?: string | null
          content_sha256_after?: string | null
          content_sha256_before?: string | null
          created_at?: string
          draft_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          product_id?: string | null
          product_version_id?: string | null
          revision_after?: number | null
          revision_before?: number | null
        }
        Update: {
          actor_user_id?: string | null
          bank_id?: string | null
          content_sha256_after?: string | null
          content_sha256_before?: string | null
          created_at?: string
          draft_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          product_id?: string | null
          product_version_id?: string | null
          revision_after?: number | null
          revision_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_catalog_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_catalog_events_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_catalog_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_catalog_events_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_document_template_revisions: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          revision: number
          template_id: string
          template_json: Json
          validation_report: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          revision: number
          template_id: string
          template_json: Json
          validation_report: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          revision?: number
          template_id?: string
          template_json?: Json
          validation_report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_document_template_revisions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_document_template_revisions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "mortgage_document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_document_templates: {
        Row: {
          active_json: Json | null
          active_published_at: string | null
          active_published_by_user_id: string | null
          active_revision: number
          active_validation_report: Json | null
          bank_id: string
          created_at: string
          created_by_user_id: string | null
          current_published_revision_id: string | null
          draft_json: Json | null
          draft_revision: number
          draft_updated_at: string | null
          draft_updated_by_user_id: string | null
          draft_validation_report: Json | null
          id: string
          label: string
          registry_version: number
          source_file_name: string
          source_sha256: string
          template_key: string
          updated_at: string
        }
        Insert: {
          active_json?: Json | null
          active_published_at?: string | null
          active_published_by_user_id?: string | null
          active_revision?: number
          active_validation_report?: Json | null
          bank_id: string
          created_at?: string
          created_by_user_id?: string | null
          current_published_revision_id?: string | null
          draft_json?: Json | null
          draft_revision?: number
          draft_updated_at?: string | null
          draft_updated_by_user_id?: string | null
          draft_validation_report?: Json | null
          id?: string
          label: string
          registry_version: number
          source_file_name: string
          source_sha256: string
          template_key: string
          updated_at?: string
        }
        Update: {
          active_json?: Json | null
          active_published_at?: string | null
          active_published_by_user_id?: string | null
          active_revision?: number
          active_validation_report?: Json | null
          bank_id?: string
          created_at?: string
          created_by_user_id?: string | null
          current_published_revision_id?: string | null
          draft_json?: Json | null
          draft_revision?: number
          draft_updated_at?: string | null
          draft_updated_by_user_id?: string | null
          draft_validation_report?: Json | null
          id?: string
          label?: string
          registry_version?: number
          source_file_name?: string
          source_sha256?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_document_templates_active_published_by_user_id_fkey"
            columns: ["active_published_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_document_templates_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_document_templates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_document_templates_current_published_revision_id_fkey"
            columns: ["current_published_revision_id"]
            isOneToOne: false
            referencedRelation: "mortgage_document_template_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_document_templates_draft_updated_by_user_id_fkey"
            columns: ["draft_updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_drafts: {
        Row: {
          base_version_id: string | null
          created_at: string
          created_by_user_id: string | null
          draft_data: Json
          id: string
          product_id: string
          revision: number
          updated_at: string
          updated_by_user_id: string | null
          validation_report: Json
        }
        Insert: {
          base_version_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          draft_data: Json
          id?: string
          product_id: string
          revision?: number
          updated_at?: string
          updated_by_user_id?: string | null
          validation_report?: Json
        }
        Update: {
          base_version_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          draft_data?: Json
          id?: string
          product_id?: string
          revision?: number
          updated_at?: string
          updated_by_user_id?: string | null
          validation_report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_drafts_base_version_fkey"
            columns: ["product_id", "base_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["product_id", "id"]
          },
          {
            foreignKeyName: "mortgage_product_drafts_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_drafts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "mortgage_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_drafts_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
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
      mortgage_product_version_document_templates: {
        Row: {
          created_at: string
          product_version_id: string
          requirement_code: string
          sort_order: number
          template_revision_id: string
        }
        Insert: {
          created_at?: string
          product_version_id: string
          requirement_code: string
          sort_order?: number
          template_revision_id: string
        }
        Update: {
          created_at?: string
          product_version_id?: string
          requirement_code?: string
          sort_order?: number
          template_revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_version_document_tem_template_revision_id_fkey"
            columns: ["template_revision_id"]
            isOneToOne: false
            referencedRelation: "mortgage_document_template_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_version_document_templ_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_version_sources: {
        Row: {
          created_at: string
          product_version_id: string
          source_document_id: string
          source_role: string
        }
        Insert: {
          created_at?: string
          product_version_id: string
          source_document_id: string
          source_role?: string
        }
        Update: {
          created_at?: string
          product_version_id?: string
          source_document_id?: string
          source_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_version_sources_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_version_sources_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "mortgage_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_version_variants: {
        Row: {
          calculation_readiness: string
          code: string
          created_at: string
          eligibility_config: Json
          fixed_period_months: number | null
          fixed_rate_pct: number | null
          id: string
          interest_type: string
          is_default: boolean
          margin_pct: number | null
          max_amount: number | null
          max_ltv_pct: number | null
          max_term_months: number | null
          min_amount: number | null
          min_ltv_pct: number | null
          min_term_months: number | null
          name: string
          pricing_config: Json
          product_version_id: string
          reference_rate_as_of: string | null
          reference_rate_code: string | null
          reference_rate_pct: number | null
          representative_apr_pct: number | null
          sort_order: number
        }
        Insert: {
          calculation_readiness?: string
          code: string
          created_at?: string
          eligibility_config?: Json
          fixed_period_months?: number | null
          fixed_rate_pct?: number | null
          id?: string
          interest_type: string
          is_default?: boolean
          margin_pct?: number | null
          max_amount?: number | null
          max_ltv_pct?: number | null
          max_term_months?: number | null
          min_amount?: number | null
          min_ltv_pct?: number | null
          min_term_months?: number | null
          name: string
          pricing_config: Json
          product_version_id: string
          reference_rate_as_of?: string | null
          reference_rate_code?: string | null
          reference_rate_pct?: number | null
          representative_apr_pct?: number | null
          sort_order?: number
        }
        Update: {
          calculation_readiness?: string
          code?: string
          created_at?: string
          eligibility_config?: Json
          fixed_period_months?: number | null
          fixed_rate_pct?: number | null
          id?: string
          interest_type?: string
          is_default?: boolean
          margin_pct?: number | null
          max_amount?: number | null
          max_ltv_pct?: number | null
          max_term_months?: number | null
          min_amount?: number | null
          min_ltv_pct?: number | null
          min_term_months?: number | null
          name?: string
          pricing_config?: Json
          product_version_id?: string
          reference_rate_as_of?: string | null
          reference_rate_code?: string | null
          reference_rate_pct?: number | null
          representative_apr_pct?: number | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_product_version_variants_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_product_versions: {
        Row: {
          assumptions: Json
          calculation_date: string | null
          calculator_engine_version: string
          calculator_schema_version: number
          completeness_score: number
          content_sha256: string
          cost_rules: Json
          created_at: string
          data_status: string
          document_requirements: Json
          effective_from: string | null
          effective_to: string | null
          fixed_period_months: number | null
          fixed_rate_pct: number | null
          id: string
          interest_type: string
          is_eco: boolean
          lifecycle_status: string
          margin_pct: number | null
          max_amount: number | null
          max_ltv_pct: number | null
          max_term_months: number | null
          min_amount: number | null
          min_term_months: number | null
          multiform_template_ids: string[]
          product_id: string
          published_at: string | null
          published_by_user_id: string | null
          reference_rate_as_of: string | null
          reference_rate_code: string | null
          reference_rate_pct: number | null
          representative_apr_pct: number | null
          representative_example: Json
          requirements: Json
          retired_at: string | null
          retired_by_user_id: string | null
          retrieved_at: string
          source_document_id: string | null
          unknown_fields: string[]
          updated_at: string
          validation_report: Json
          version_key: string
          version_number: number
        }
        Insert: {
          assumptions?: Json
          calculation_date?: string | null
          calculator_engine_version?: string
          calculator_schema_version?: number
          completeness_score: number
          content_sha256: string
          cost_rules?: Json
          created_at?: string
          data_status: string
          document_requirements?: Json
          effective_from?: string | null
          effective_to?: string | null
          fixed_period_months?: number | null
          fixed_rate_pct?: number | null
          id?: string
          interest_type: string
          is_eco?: boolean
          lifecycle_status?: string
          margin_pct?: number | null
          max_amount?: number | null
          max_ltv_pct?: number | null
          max_term_months?: number | null
          min_amount?: number | null
          min_term_months?: number | null
          multiform_template_ids?: string[]
          product_id: string
          published_at?: string | null
          published_by_user_id?: string | null
          reference_rate_as_of?: string | null
          reference_rate_code?: string | null
          reference_rate_pct?: number | null
          representative_apr_pct?: number | null
          representative_example?: Json
          requirements?: Json
          retired_at?: string | null
          retired_by_user_id?: string | null
          retrieved_at: string
          source_document_id?: string | null
          unknown_fields?: string[]
          updated_at?: string
          validation_report?: Json
          version_key: string
          version_number: number
        }
        Update: {
          assumptions?: Json
          calculation_date?: string | null
          calculator_engine_version?: string
          calculator_schema_version?: number
          completeness_score?: number
          content_sha256?: string
          cost_rules?: Json
          created_at?: string
          data_status?: string
          document_requirements?: Json
          effective_from?: string | null
          effective_to?: string | null
          fixed_period_months?: number | null
          fixed_rate_pct?: number | null
          id?: string
          interest_type?: string
          is_eco?: boolean
          lifecycle_status?: string
          margin_pct?: number | null
          max_amount?: number | null
          max_ltv_pct?: number | null
          max_term_months?: number | null
          min_amount?: number | null
          min_term_months?: number | null
          multiform_template_ids?: string[]
          product_id?: string
          published_at?: string | null
          published_by_user_id?: string | null
          reference_rate_as_of?: string | null
          reference_rate_code?: string | null
          reference_rate_pct?: number | null
          representative_apr_pct?: number | null
          representative_example?: Json
          requirements?: Json
          retired_at?: string | null
          retired_by_user_id?: string | null
          retrieved_at?: string
          source_document_id?: string | null
          unknown_fields?: string[]
          updated_at?: string
          validation_report?: Json
          version_key?: string
          version_number?: number
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
            foreignKeyName: "mortgage_product_versions_published_by_user_id_fkey"
            columns: ["published_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_product_versions_retired_by_user_id_fkey"
            columns: ["retired_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          archived_at: string | null
          archived_by_user_id: string | null
          bank_id: string
          category: string
          created_at: string
          created_by_user_id: string | null
          current_published_version_id: string | null
          distribution_channel: string
          id: string
          is_active: boolean
          name: string
          product_kind: string
          revision: number
          slug: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by_user_id?: string | null
          bank_id: string
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          current_published_version_id?: string | null
          distribution_channel?: string
          id?: string
          is_active?: boolean
          name: string
          product_kind?: string
          revision?: number
          slug: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by_user_id?: string | null
          bank_id?: string
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          current_published_version_id?: string | null
          distribution_channel?: string
          id?: string
          is_active?: boolean
          name?: string
          product_kind?: string
          revision?: number
          slug?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_products_archived_by_user_id_fkey"
            columns: ["archived_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_products_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "mortgage_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_products_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_products_current_published_version_fkey"
            columns: ["id", "current_published_version_id"]
            isOneToOne: false
            referencedRelation: "mortgage_product_versions"
            referencedColumns: ["product_id", "id"]
          },
          {
            foreignKeyName: "mortgage_products_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      organization_user_preferences: {
        Row: {
          created_at: string
          default_facility_id: string | null
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_facility_id?: string | null
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_facility_id?: string | null
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_user_preferences_default_facility_fkey"
            columns: ["organization_id", "default_facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_user_preferences_membership_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
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
      platform_user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
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
      create_crm_case_bank_application: {
        Args: {
          target_case_id: string
          target_offer_id: string
          target_organization_id: string
          target_property_id?: string
        }
        Returns: {
          appraisal_value_amount: number | null
          bank_id: string
          calculated_at: string | null
          calculation_snapshot: Json | null
          calculator_version: string | null
          case_id: string
          case_item_id: string
          collateral_value_amount: number | null
          collateral_value_basis: string | null
          comparison_baseline_offer_id: string | null
          cost_first_five_years: number | null
          created_at: string
          created_by_user_id: string | null
          financed_costs: number | null
          first_installment: number | null
          first_monthly_outflow: number | null
          gross_loan_amount: number | null
          ltv_debt_amount: number | null
          ltv_debt_basis: string | null
          ltv_pct: number | null
          net_loan_amount: number | null
          offer_id: string
          organization_id: string
          property_id: string | null
          purchase_price_amount: number | null
          scenario_snapshot: Json | null
          slot: number
          snapshot_schema_version: string | null
          snapshot_status: string
          submission_id: string
          total_cost: number | null
        }
        SetofOptions: {
          from: "*"
          to: "crm_case_bank_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_crm_case_bank_application_snapshot: {
        Args: {
          expected_property_updated_at: string
          target_actor_user_id: string
          target_calculation_snapshot: Json
          target_case_id: string
          target_offer_id: string
          target_organization_id: string
          target_property_id: string
          target_scenario_snapshot: Json
        }
        Returns: {
          appraisal_value_amount: number | null
          bank_id: string
          calculated_at: string | null
          calculation_snapshot: Json | null
          calculator_version: string | null
          case_id: string
          case_item_id: string
          collateral_value_amount: number | null
          collateral_value_basis: string | null
          comparison_baseline_offer_id: string | null
          cost_first_five_years: number | null
          created_at: string
          created_by_user_id: string | null
          financed_costs: number | null
          first_installment: number | null
          first_monthly_outflow: number | null
          gross_loan_amount: number | null
          ltv_debt_amount: number | null
          ltv_debt_basis: string | null
          ltv_pct: number | null
          net_loan_amount: number | null
          offer_id: string
          organization_id: string
          property_id: string | null
          purchase_price_amount: number | null
          scenario_snapshot: Json | null
          slot: number
          snapshot_schema_version: string | null
          snapshot_status: string
          submission_id: string
          total_cost: number | null
        }
        SetofOptions: {
          from: "*"
          to: "crm_case_bank_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_crm_case_simple: {
        Args: {
          p_client_ids: string[]
          p_organization_id: string
          p_owner_user_id?: string
          p_title: string
        }
        Returns: Json
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
      create_mortgage_product_draft_v2: {
        Args: {
          p_actor_user_id: string
          p_bank_id: string
          p_category: string
          p_distribution_channel: string
          p_draft_data: Json
          p_name: string
          p_slug: string
        }
        Returns: Json
      }
      create_organization_with_admin: {
        Args: { full_name?: string; organization_name: string }
        Returns: Json
      }
      create_staff_appointment:
        | {
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
        | {
            Args: {
              p_client_id: string
              p_client_person_id: string
              p_created_by_user_id: string
              p_expert_user_id: string
              p_facility_id: string
              p_idempotency_key: string
              p_meeting_mode: string
              p_meeting_url: string
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
      get_booking_widget_analytics: {
        Args: {
          p_from: string
          p_organization_id: string
          p_to: string
          p_widget_id: string
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
      get_personal_booking_widget_counts: {
        Args: {
          p_expert_user_id: string
          p_organization_id: string
          p_since: string
        }
        Returns: {
          bookings: number
          widget_id: string
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
      publish_mortgage_document_template_draft: {
        Args: {
          p_actor_user_id: string
          p_bank_id: string
          p_expected_revision: number
          p_template_key: string
        }
        Returns: Json
      }
      publish_mortgage_product_draft: {
        Args: {
          p_actor_user_id: string
          p_expected_revision: number
          p_product_id: string
        }
        Returns: {
          version_id: string
          version_number: number
        }[]
      }
      record_booking_widget_event: {
        Args: {
          p_event_id?: string
          p_event_type: string
          p_is_embedded?: boolean
          p_service_id?: string
          p_visit_id: string
          p_widget_token: string
        }
        Returns: undefined
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
      save_mortgage_document_template_draft: {
        Args: {
          p_actor_user_id: string
          p_bank_id: string
          p_expected_revision: number
          p_label: string
          p_registry_version: number
          p_source_file_name: string
          p_source_sha256: string
          p_template_json: Json
          p_template_key: string
          p_validation_report: Json
        }
        Returns: Json
      }
      save_mortgage_product_draft_v2: {
        Args: {
          p_actor_user_id: string
          p_draft_data: Json
          p_expected_revision: number
          p_product_id: string
        }
        Returns: Json
      }
      search_crm_cases: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      search_crm_cases_with_context: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      search_crm_clients: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      search_crm_clients_ranked: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      set_crm_case_clients: {
        Args: {
          p_case_id: string
          p_client_ids: string[]
          p_organization_id: string
        }
        Returns: Json
      }
      set_facility_cover_image: {
        Args: {
          p_facility_id: string
          p_image_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      sign_crm_case_contract: {
        Args: {
          target_application_id: string
          target_case_id: string
          target_organization_id: string
        }
        Returns: {
          application_id: string
          case_id: string
          organization_id: string
          signed_at: string
          signed_by_user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_case_contract_selections"
          isOneToOne: true
          isSetofReturn: false
        }
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
