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
            foreignKeyName: "crm_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            foreignKeyName: "crm_case_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
      crm_client_people: {
        Row: {
          client_id: string
          created_at: string
          date_of_birth: string | null
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          metadata: Json
          organization_id: string
          pesel: string | null
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date_of_birth?: string | null
          display_name: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          organization_id: string
          pesel?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date_of_birth?: string | null
          display_name?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          organization_id?: string
          pesel?: string | null
          phone?: string | null
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
          primary_phone: string | null
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
          primary_phone?: string | null
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
          primary_phone?: string | null
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
            foreignKeyName: "crm_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            foreignKeyName: "crm_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
      mortgage_banks: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
          website_url?: string
        }
        Relationships: []
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

