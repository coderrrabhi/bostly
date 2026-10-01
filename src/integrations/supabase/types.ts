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
      bundle_items: {
        Row: {
          bundle_id: string
          created_at: string | null
          default_drip_interval: number | null
          default_drip_interval_unit: string | null
          default_drip_qty_per_run: number | null
          engagement_type: string
          id: string
          is_base: boolean | null
          price_per_k: number | null
          ratio_percent: number | null
          service_id: string | null
          sort_order: number | null
        }
        Insert: {
          bundle_id: string
          created_at?: string | null
          default_drip_interval?: number | null
          default_drip_interval_unit?: string | null
          default_drip_qty_per_run?: number | null
          engagement_type: string
          id?: string
          is_base?: boolean | null
          price_per_k?: number | null
          ratio_percent?: number | null
          service_id?: string | null
          sort_order?: number | null
        }
        Update: {
          bundle_id?: string
          created_at?: string | null
          default_drip_interval?: number | null
          default_drip_interval_unit?: string | null
          default_drip_qty_per_run?: number | null
          engagement_type?: string
          id?: string
          is_base?: boolean | null
          price_per_k?: number | null
          ratio_percent?: number | null
          service_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bundle_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "engagement_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          status: string
          updated_at: string
          user_email: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
          user_email: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
          user_email?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          sender_id: string
          sender_role: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          sender_id: string
          sender_role: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          sender_id?: string
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_bundles: {
        Row: {
          ai_organic_enabled: boolean | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          platform: string
          provider_id: string | null
          sort_order: number | null
          updated_at: string | null
          use_custom_ratios: boolean | null
        }
        Insert: {
          ai_organic_enabled?: boolean | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          platform: string
          provider_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
          use_custom_ratios?: boolean | null
        }
        Update: {
          ai_organic_enabled?: boolean | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          platform?: string
          provider_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
          use_custom_ratios?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_bundles_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_order_items: {
        Row: {
          created_at: string | null
          delivered_count: number
          drip_interval: number | null
          drip_interval_unit: string | null
          drip_qty_per_run: number | null
          engagement_order_id: string
          engagement_type: string
          error_message: string | null
          id: string
          is_enabled: boolean | null
          price: number
          provider_mappings: Json | null
          provider_order_id: string | null
          quantity: number
          service_id: string | null
          speed_preset: string | null
          status: string | null
          updated_at: string | null
          user_bundle_item_id: string | null
          user_provider_account_id: string | null
          user_service_id: string | null
        }
        Insert: {
          created_at?: string | null
          delivered_count?: number
          drip_interval?: number | null
          drip_interval_unit?: string | null
          drip_qty_per_run?: number | null
          engagement_order_id: string
          engagement_type: string
          error_message?: string | null
          id?: string
          is_enabled?: boolean | null
          price?: number
          provider_mappings?: Json | null
          provider_order_id?: string | null
          quantity: number
          service_id?: string | null
          speed_preset?: string | null
          status?: string | null
          updated_at?: string | null
          user_bundle_item_id?: string | null
          user_provider_account_id?: string | null
          user_service_id?: string | null
        }
        Update: {
          created_at?: string | null
          delivered_count?: number
          drip_interval?: number | null
          drip_interval_unit?: string | null
          drip_qty_per_run?: number | null
          engagement_order_id?: string
          engagement_type?: string
          error_message?: string | null
          id?: string
          is_enabled?: boolean | null
          price?: number
          provider_mappings?: Json | null
          provider_order_id?: string | null
          quantity?: number
          service_id?: string | null
          speed_preset?: string | null
          status?: string | null
          updated_at?: string | null
          user_bundle_item_id?: string | null
          user_provider_account_id?: string | null
          user_service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_order_items_engagement_order_id_fkey"
            columns: ["engagement_order_id"]
            isOneToOne: false
            referencedRelation: "engagement_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_order_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_order_items_user_bundle_item_id_fkey"
            columns: ["user_bundle_item_id"]
            isOneToOne: false
            referencedRelation: "user_bundle_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_order_items_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_order_items_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_order_items_user_service_id_fkey"
            columns: ["user_service_id"]
            isOneToOne: false
            referencedRelation: "user_services"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_orders: {
        Row: {
          base_quantity: number
          bundle_id: string | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          is_organic_mode: boolean | null
          link: string
          order_number: number
          peak_hours_enabled: boolean | null
          status: string | null
          total_price: number
          updated_at: string | null
          user_bundle_id: string | null
          user_id: string
          variance_percent: number | null
        }
        Insert: {
          base_quantity: number
          bundle_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_organic_mode?: boolean | null
          link: string
          order_number?: number
          peak_hours_enabled?: boolean | null
          status?: string | null
          total_price?: number
          updated_at?: string | null
          user_bundle_id?: string | null
          user_id: string
          variance_percent?: number | null
        }
        Update: {
          base_quantity?: number
          bundle_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_organic_mode?: boolean | null
          link?: string
          order_number?: number
          peak_hours_enabled?: boolean | null
          status?: string | null
          total_price?: number
          updated_at?: string | null
          user_bundle_id?: string | null
          user_id?: string
          variance_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_orders_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "engagement_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_orders_user_bundle_id_fkey"
            columns: ["user_bundle_id"]
            isOneToOne: false
            referencedRelation: "user_bundles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          last_status_check: string | null
          link: string
          next_retry_at: string | null
          order_number: number
          price: number
          provider_order_id: string | null
          provider_used: string | null
          quantity: number
          remains: number | null
          retry_count: number
          service_id: string
          start_count: number | null
          status: string
          tried_providers: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_status_check?: string | null
          link: string
          next_retry_at?: string | null
          order_number?: number
          price?: number
          provider_order_id?: string | null
          provider_used?: string | null
          quantity: number
          remains?: number | null
          retry_count?: number
          service_id: string
          start_count?: number | null
          status?: string
          tried_providers?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_status_check?: string | null
          link?: string
          next_retry_at?: string | null
          order_number?: number
          price?: number
          provider_order_id?: string | null
          provider_used?: string | null
          quantity?: number
          remains?: number | null
          retry_count?: number
          service_id?: string
          start_count?: number | null
          status?: string
          tried_providers?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_provider_used_fkey"
            columns: ["provider_used"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      organic_run_schedule: {
        Row: {
          base_quantity: number
          completed_at: string | null
          created_at: string | null
          engagement_order_item_id: string | null
          error_message: string | null
          id: string
          last_status_check: string | null
          order_id: string | null
          peak_multiplier: number | null
          provider_account_id: string | null
          provider_account_name: string | null
          provider_charge: number | null
          provider_order_id: string | null
          provider_remains: number | null
          provider_response: Json | null
          provider_start_count: number | null
          provider_status: string | null
          quantity_to_send: number
          retry_count: number
          rotation_lock_key: string | null
          run_number: number
          scheduled_at: string
          started_at: string | null
          status: string | null
          updated_at: string | null
          user_provider_account_id: string | null
          user_provider_account_name: string | null
          variance_applied: number | null
        }
        Insert: {
          base_quantity: number
          completed_at?: string | null
          created_at?: string | null
          engagement_order_item_id?: string | null
          error_message?: string | null
          id?: string
          last_status_check?: string | null
          order_id?: string | null
          peak_multiplier?: number | null
          provider_account_id?: string | null
          provider_account_name?: string | null
          provider_charge?: number | null
          provider_order_id?: string | null
          provider_remains?: number | null
          provider_response?: Json | null
          provider_start_count?: number | null
          provider_status?: string | null
          quantity_to_send: number
          retry_count?: number
          rotation_lock_key?: string | null
          run_number: number
          scheduled_at: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          user_provider_account_id?: string | null
          user_provider_account_name?: string | null
          variance_applied?: number | null
        }
        Update: {
          base_quantity?: number
          completed_at?: string | null
          created_at?: string | null
          engagement_order_item_id?: string | null
          error_message?: string | null
          id?: string
          last_status_check?: string | null
          order_id?: string | null
          peak_multiplier?: number | null
          provider_account_id?: string | null
          provider_account_name?: string | null
          provider_charge?: number | null
          provider_order_id?: string | null
          provider_remains?: number | null
          provider_response?: Json | null
          provider_start_count?: number | null
          provider_status?: string | null
          quantity_to_send?: number
          retry_count?: number
          rotation_lock_key?: string | null
          run_number?: number
          scheduled_at?: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          user_provider_account_id?: string | null
          user_provider_account_name?: string | null
          variance_applied?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organic_run_schedule_engagement_order_item_id_fkey"
            columns: ["engagement_order_item_id"]
            isOneToOne: false
            referencedRelation: "engagement_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organic_run_schedule_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organic_run_schedule_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organic_run_schedule_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organic_run_schedule_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      oxapay_deposits: {
        Row: {
          amount_inr: number
          amount_usd: number
          created_at: string
          credited: boolean
          id: string
          order_id: string
          pay_currency: string | null
          payment_url: string | null
          raw_payload: Json | null
          status: string
          track_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_inr: number
          amount_usd: number
          created_at?: string
          credited?: boolean
          id?: string
          order_id: string
          pay_currency?: string | null
          payment_url?: string | null
          raw_payload?: Json | null
          status?: string
          track_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_inr?: number
          amount_usd?: number
          created_at?: string
          credited?: boolean
          id?: string
          order_id?: string
          pay_currency?: string | null
          payment_url?: string | null
          raw_payload?: Json | null
          status?: string
          track_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      oxapay_webhook_events: {
        Row: {
          credit_result: Json | null
          event_hash: string
          id: string
          notes: string | null
          order_id: string | null
          payload: Json | null
          processed: boolean
          received_at: string
          signature_valid: boolean
          source_ip: string | null
          status: string | null
          track_id: string | null
        }
        Insert: {
          credit_result?: Json | null
          event_hash: string
          id?: string
          notes?: string | null
          order_id?: string | null
          payload?: Json | null
          processed?: boolean
          received_at?: string
          signature_valid?: boolean
          source_ip?: string | null
          status?: string | null
          track_id?: string | null
        }
        Update: {
          credit_result?: Json | null
          event_hash?: string
          id?: string
          notes?: string | null
          order_id?: string | null
          payload?: Json | null
          processed?: boolean
          received_at?: string
          signature_valid?: boolean
          source_ip?: string | null
          status?: string | null
          track_id?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          global_markup_percent: number
          id: string
          maintenance_mode: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          global_markup_percent?: number
          id?: string
          maintenance_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          global_markup_percent?: number
          id?: string
          maintenance_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          api_key: string | null
          avatar_url: string | null
          banned_at: string | null
          banned_reason: string | null
          created_at: string | null
          currency: string | null
          email: string
          full_name: string | null
          id: string
          is_banned: boolean
          is_organic_mode_default: boolean | null
          organic_peak_hours_enabled: boolean | null
          organic_ratios: Json | null
          organic_variance_percent: number | null
          telegram_chat_id: string | null
          telegram_id: string | null
          telegram_notifications_enabled: boolean | null
          telegram_username: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          api_key?: string | null
          avatar_url?: string | null
          banned_at?: string | null
          banned_reason?: string | null
          created_at?: string | null
          currency?: string | null
          email: string
          full_name?: string | null
          id?: string
          is_banned?: boolean
          is_organic_mode_default?: boolean | null
          organic_peak_hours_enabled?: boolean | null
          organic_ratios?: Json | null
          organic_variance_percent?: number | null
          telegram_chat_id?: string | null
          telegram_id?: string | null
          telegram_notifications_enabled?: boolean | null
          telegram_username?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          api_key?: string | null
          avatar_url?: string | null
          banned_at?: string | null
          banned_reason?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_banned?: boolean
          is_organic_mode_default?: boolean | null
          organic_peak_hours_enabled?: boolean | null
          organic_ratios?: Json | null
          organic_variance_percent?: number | null
          telegram_chat_id?: string | null
          telegram_id?: string | null
          telegram_notifications_enabled?: boolean | null
          telegram_username?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      provider_accounts: {
        Row: {
          api_key: string
          api_url: string
          balance: number | null
          balance_cached: number | null
          balance_currency: string | null
          created_at: string
          delivery_multiplier: number | null
          id: string
          is_active: boolean
          last_balance_check: string | null
          last_used_at: string | null
          name: string
          priority: number
          provider_id: string
          updated_at: string
        }
        Insert: {
          api_key: string
          api_url: string
          balance?: number | null
          balance_cached?: number | null
          balance_currency?: string | null
          created_at?: string
          delivery_multiplier?: number | null
          id?: string
          is_active?: boolean
          last_balance_check?: string | null
          last_used_at?: string | null
          name: string
          priority?: number
          provider_id: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          api_url?: string
          balance?: number | null
          balance_cached?: number | null
          balance_currency?: string | null
          created_at?: string
          delivery_multiplier?: number | null
          id?: string
          is_active?: boolean
          last_balance_check?: string | null
          last_used_at?: string | null
          name?: string
          priority?: number
          provider_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          api_key: string
          api_url: string
          balance: number | null
          created_at: string
          currency: string | null
          id: string
          is_active: boolean
          last_balance_check: string | null
          name: string
          updated_at: string
        }
        Insert: {
          api_key: string
          api_url: string
          balance?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          is_active?: boolean
          last_balance_check?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          api_url?: string
          balance?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          is_active?: boolean
          last_balance_check?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_provider_mapping: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_quantity: number | null
          min_quantity: number | null
          priority: number | null
          provider_account_id: string | null
          provider_id: string | null
          provider_service_id: string
          service_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_quantity?: number | null
          min_quantity?: number | null
          priority?: number | null
          provider_account_id?: string | null
          provider_id?: string | null
          provider_service_id: string
          service_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_quantity?: number | null
          min_quantity?: number | null
          priority?: number | null
          provider_account_id?: string | null
          provider_id?: string | null
          provider_service_id?: string
          service_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_provider_mapping_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_mapping_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_mapping_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: string
          created_at: string
          description: string | null
          drip_feed_enabled: boolean
          id: string
          is_active: boolean
          max_quantity: number
          min_quantity: number
          name: string
          price: number
          provider_id: string | null
          provider_service_id: string
          quality: string | null
          speed: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          drip_feed_enabled?: boolean
          id?: string
          is_active?: boolean
          max_quantity?: number
          min_quantity?: number
          name: string
          price?: number
          provider_id?: string | null
          provider_service_id: string
          quality?: string | null
          speed?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          drip_feed_enabled?: boolean
          id?: string
          is_active?: boolean
          max_quantity?: number
          min_quantity?: number
          name?: string
          price?: number
          provider_id?: string | null
          provider_service_id?: string
          quality?: string | null
          speed?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscription_payments: {
        Row: {
          activated: boolean
          amount_inr: number | null
          amount_usd: number | null
          created_at: string
          id: string
          order_id: string
          payment_url: string | null
          plan_type: string
          provider: string
          raw_payload: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated?: boolean
          amount_inr?: number | null
          amount_usd?: number | null
          created_at?: string
          id?: string
          order_id: string
          payment_url?: string | null
          plan_type: string
          provider: string
          raw_payload?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated?: boolean
          amount_inr?: number | null
          amount_usd?: number | null
          created_at?: string
          id?: string
          order_id?: string
          payment_url?: string | null
          plan_type?: string
          provider?: string
          raw_payload?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          created_at: string
          duration_days: number | null
          id: string
          is_active: boolean
          label: string | null
          name: string
          plan_type: string
          price: number
          price_inr: number | null
          price_usd: number | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          duration_days?: number | null
          id?: string
          is_active?: boolean
          label?: string | null
          name: string
          plan_type: string
          price: number
          price_inr?: number | null
          price_usd?: number | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          duration_days?: number | null
          id?: string
          is_active?: boolean
          label?: string | null
          name?: string
          plan_type?: string
          price?: number
          price_inr?: number | null
          price_usd?: number | null
          sort_order?: number | null
        }
        Relationships: []
      }
      subscription_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          message: string | null
          phone: string | null
          plan_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          message?: string | null
          phone?: string | null
          plan_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string | null
          phone?: string | null
          plan_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          plan_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_type?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          category: string | null
          created_at: string
          id: string
          message: string
          order_id: string | null
          priority: string | null
          status: string | null
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          message: string
          order_id?: string | null
          priority?: string | null
          status?: string | null
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          message?: string
          order_id?: string | null
          priority?: string | null
          status?: string | null
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          payment_method: string | null
          payment_reference: string | null
          status: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          status?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          status?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_bundle_item_providers: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          priority: number
          provider_service_id: string | null
          updated_at: string
          user_bundle_item_id: string
          user_id: string
          user_provider_account_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number
          provider_service_id?: string | null
          updated_at?: string
          user_bundle_item_id: string
          user_id: string
          user_provider_account_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number
          provider_service_id?: string | null
          updated_at?: string
          user_bundle_item_id?: string
          user_id?: string
          user_provider_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_bundle_item_providers_user_bundle_item_id_fkey"
            columns: ["user_bundle_item_id"]
            isOneToOne: false
            referencedRelation: "user_bundle_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_bundle_item_providers_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_bundle_item_providers_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bundle_items: {
        Row: {
          created_at: string
          engagement_type: string
          id: string
          priority: number
          quantity: number
          updated_at: string
          user_bundle_id: string
          user_id: string
          user_service_id: string | null
        }
        Insert: {
          created_at?: string
          engagement_type: string
          id?: string
          priority?: number
          quantity?: number
          updated_at?: string
          user_bundle_id: string
          user_id: string
          user_service_id?: string | null
        }
        Update: {
          created_at?: string
          engagement_type?: string
          id?: string
          priority?: number
          quantity?: number
          updated_at?: string
          user_bundle_id?: string
          user_id?: string
          user_service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_bundle_items_user_bundle_id_fkey"
            columns: ["user_bundle_id"]
            isOneToOne: false
            referencedRelation: "user_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_bundle_items_user_service_id_fkey"
            columns: ["user_service_id"]
            isOneToOne: false
            referencedRelation: "user_services"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bundles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          platform: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          platform?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          platform?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_provider_accounts: {
        Row: {
          api_key_ciphertext: string
          api_key_hint: string | null
          api_url: string
          balance_cached: number | null
          balance_currency: string | null
          created_at: string
          id: string
          is_active: boolean
          last_test_error: string | null
          last_test_ok: boolean | null
          last_tested_at: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_ciphertext: string
          api_key_hint?: string | null
          api_url: string
          balance_cached?: number | null
          balance_currency?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_ciphertext?: string
          api_key_hint?: string | null
          api_url?: string
          balance_cached?: number | null
          balance_currency?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_services: {
        Row: {
          cancel_allowed: boolean
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          max_quantity: number
          min_quantity: number
          name: string
          provider_service_id: string
          rate: number
          raw: Json | null
          refill: boolean
          type: string | null
          updated_at: string
          user_id: string
          user_provider_account_id: string
        }
        Insert: {
          cancel_allowed?: boolean
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          max_quantity?: number
          min_quantity?: number
          name: string
          provider_service_id: string
          rate?: number
          raw?: Json | null
          refill?: boolean
          type?: string | null
          updated_at?: string
          user_id: string
          user_provider_account_id: string
        }
        Update: {
          cancel_allowed?: boolean
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          max_quantity?: number
          min_quantity?: number
          name?: string
          provider_service_id?: string
          rate?: number
          raw?: Json | null
          refill?: boolean
          type?: string | null
          updated_at?: string
          user_id?: string
          user_provider_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_services_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_services_user_provider_account_id_fkey"
            columns: ["user_provider_account_id"]
            isOneToOne: false
            referencedRelation: "user_provider_accounts_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          total_deposited: number
          total_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          total_deposited?: number
          total_spent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          total_deposited?: number
          total_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      zapupi_deposits: {
        Row: {
          amount_inr: number
          amount_usd: number | null
          created_at: string
          credited: boolean
          gateway_response: Json | null
          id: string
          order_id: string
          payment_url: string | null
          status: string
          txn_id: string | null
          updated_at: string
          user_id: string
          utr: string | null
        }
        Insert: {
          amount_inr: number
          amount_usd?: number | null
          created_at?: string
          credited?: boolean
          gateway_response?: Json | null
          id?: string
          order_id: string
          payment_url?: string | null
          status?: string
          txn_id?: string | null
          updated_at?: string
          user_id: string
          utr?: string | null
        }
        Update: {
          amount_inr?: number
          amount_usd?: number | null
          created_at?: string
          credited?: boolean
          gateway_response?: Json | null
          id?: string
          order_id?: string
          payment_url?: string | null
          status?: string
          txn_id?: string | null
          updated_at?: string
          user_id?: string
          utr?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      user_provider_accounts_safe: {
        Row: {
          api_key_hint: string | null
          api_url: string | null
          balance_cached: number | null
          balance_currency: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          last_test_error: string | null
          last_test_ok: boolean | null
          last_tested_at: string | null
          name: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          api_key_hint?: string | null
          api_url?: string | null
          balance_cached?: number | null
          balance_currency?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          api_key_hint?: string | null
          api_url?: string | null
          balance_cached?: number | null
          balance_currency?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_subscription_from_payment: {
        Args: { p_order_id: string }
        Returns: Json
      }
      cleanup_old_completed_engagement_orders: { Args: never; Returns: Json }
      dispatch_check_order_status: { Args: never; Returns: undefined }
      dispatch_check_provider_balance: { Args: never; Returns: undefined }
      dispatch_execute_all_runs: { Args: never; Returns: undefined }
      get_admin_users_summary: {
        Args: never
        Returns: {
          active_engagement_orders: number
          active_single_orders: number
          balance: number
          banned_at: string
          banned_reason: string
          created_at: string
          currency: string
          email: string
          full_name: string
          id: string
          is_banned: boolean
          paused_engagement_orders: number
          paused_single_orders: number
          plan_type: string
          role: string
          subscription_expires: string
          subscription_status: string
          total_deposited: number
          total_spent: number
          user_id: string
        }[]
      }
      get_provider_topup_breakdown: {
        Args: never
        Returns: {
          pending_quantity: number
          pending_runs: number
          pending_user_usd: number
          provider_id: string
          provider_name: string
          service_category: string
          service_id: string
          service_name: string
        }[]
      }
      get_provider_topup_plan: {
        Args: never
        Returns: {
          markup_percent: number
          pending_runs: number
          pending_user_usd: number
          provider_id: string
          provider_name: string
        }[]
      }
      get_queue_health: { Args: never; Returns: Json }
      get_top_pending_users: {
        Args: { p_limit?: number }
        Returns: {
          email: string
          full_name: string
          pending_orders: number
          pending_value_usd: number
          total_deposited: number
          total_spent: number
          user_id: string
          wallet_balance: number
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_active_subscription: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_maintenance_mode: { Args: never; Returns: boolean }
      reschedule_organic_run:
        | {
            Args: { p_delay_minutes?: number; p_run_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_quantity: number
              p_run_id: string
              p_scheduled_at: string
            }
            Returns: Json
          }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
