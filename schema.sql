-- =====================================================================
-- Boostly Pro — complete PostgreSQL schema for self-hosting
-- Usage:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT everywhere).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS lovable_legacy;
SET search_path = lovable_legacy, public;

CREATE SEQUENCE IF NOT EXISTS lovable_legacy.orders_order_number_seq;
CREATE SEQUENCE IF NOT EXISTS lovable_legacy.engagement_orders_order_number_seq;

-- ---------------------------------------------------------------------
-- Accounts (replaces Supabase auth.users). Passwords are bcrypt digests,
-- verified with crypt(); existing users keep their passwords.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lovable_legacy.auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_uidx ON lovable_legacy.auth_users (lower(email));

CREATE TABLE IF NOT EXISTS lovable_legacy.auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES lovable_legacy.auth_users(id) ON DELETE CASCADE,
  password_digest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  full_name text,
  api_key text,
  currency text DEFAULT 'USD',
  telegram_chat_id text,
  telegram_notifications_enabled boolean DEFAULT false,
  organic_variance_percent integer DEFAULT 25,
  organic_peak_hours_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  avatar_url text,
  telegram_id text,
  telegram_username text,
  is_organic_mode_default boolean DEFAULT true,
  organic_ratios jsonb,
  is_banned boolean NOT NULL DEFAULT false,
  banned_reason text,
  banned_at timestamptz
);

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  total_deposited numeric NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id text PRIMARY KEY DEFAULT 'global',
  global_markup_percent numeric NOT NULL DEFAULT 0,
  maintenance_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  api_url text NOT NULL,
  api_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  balance numeric DEFAULT 0,
  currency text DEFAULT 'USD',
  last_balance_check timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  name text NOT NULL,
  api_key text NOT NULL,
  api_url text NOT NULL,
  priority integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  balance_cached numeric(14,4),
  balance_currency text,
  last_balance_check timestamptz,
  delivery_multiplier numeric DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  balance numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  min_quantity integer NOT NULL DEFAULT 1,
  max_quantity integer NOT NULL DEFAULT 100000,
  is_active boolean NOT NULL DEFAULT true,
  provider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_service_id text NOT NULL,
  speed text DEFAULT 'medium',
  quality text DEFAULT 'standard',
  drip_feed_enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS service_provider_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES providers(id) ON DELETE CASCADE,
  provider_service_id text NOT NULL,
  priority integer DEFAULT 1,
  min_quantity integer DEFAULT 1,
  max_quantity integer DEFAULT 100000,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (service_id, provider_id)
);

CREATE TABLE IF NOT EXISTS engagement_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  platform text NOT NULL,
  provider_id uuid REFERENCES providers(id) ON DELETE SET NULL,
  description text,
  icon text DEFAULT 'rocket',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  use_custom_ratios boolean DEFAULT false,
  ai_organic_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES engagement_bundles(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  engagement_type text NOT NULL,
  ratio_percent numeric DEFAULT 100,
  price_per_k numeric DEFAULT 0,
  is_base boolean DEFAULT false,
  default_drip_qty_per_run integer DEFAULT 500,
  default_drip_interval integer DEFAULT 1,
  default_drip_interval_unit text DEFAULT 'hours',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  api_url text NOT NULL,
  api_key_ciphertext text NOT NULL,
  api_key_hint text,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 1,
  balance_cached numeric(14,4),
  balance_currency text,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_provider_account_id uuid NOT NULL REFERENCES user_provider_accounts(id) ON DELETE CASCADE,
  provider_service_id text NOT NULL,
  name text NOT NULL,
  category text,
  type text,
  rate numeric(14,4) NOT NULL DEFAULT 0,
  min_quantity integer NOT NULL DEFAULT 1,
  max_quantity integer NOT NULL DEFAULT 1000000,
  refill boolean NOT NULL DEFAULT false,
  cancel_allowed boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_provider_account_id, provider_service_id)
);

CREATE TABLE IF NOT EXISTS user_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  platform text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_bundle_id uuid NOT NULL REFERENCES user_bundles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_service_id uuid REFERENCES user_services(id) ON DELETE SET NULL,
  engagement_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 100,
  priority integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_bundle_item_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_bundle_item_id uuid NOT NULL REFERENCES user_bundle_items(id) ON DELETE CASCADE,
  user_provider_account_id uuid NOT NULL REFERENCES user_provider_accounts(id) ON DELETE CASCADE,
  provider_service_id text,
  priority integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_bundle_item_id, user_provider_account_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint NOT NULL UNIQUE DEFAULT nextval('lovable_legacy.orders_order_number_seq'),
  user_id uuid NOT NULL,
  service_id uuid NOT NULL REFERENCES services(id),
  link text NOT NULL,
  quantity integer NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  provider_order_id text,
  provider_used uuid REFERENCES providers(id),
  tried_providers uuid[] NOT NULL DEFAULT '{}',
  start_count integer DEFAULT 0,
  remains integer,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_status_check timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint NOT NULL UNIQUE DEFAULT nextval('lovable_legacy.engagement_orders_order_number_seq'),
  user_id uuid NOT NULL,
  bundle_id uuid REFERENCES engagement_bundles(id) ON DELETE SET NULL,
  user_bundle_id uuid REFERENCES user_bundles(id) ON DELETE SET NULL,
  link text NOT NULL,
  base_quantity integer NOT NULL,
  total_price numeric NOT NULL DEFAULT 0,
  is_organic_mode boolean DEFAULT true,
  variance_percent integer DEFAULT 25,
  peak_hours_enabled boolean DEFAULT true,
  status text DEFAULT 'pending',
  error_message text,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_order_id uuid NOT NULL REFERENCES engagement_orders(id) ON DELETE CASCADE,
  engagement_type text NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  user_service_id uuid REFERENCES user_services(id) ON DELETE SET NULL,
  user_provider_account_id uuid REFERENCES user_provider_accounts(id) ON DELETE SET NULL,
  user_bundle_item_id uuid REFERENCES user_bundle_items(id) ON DELETE SET NULL,
  provider_mappings jsonb,
  quantity integer NOT NULL,
  delivered_count integer NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  drip_qty_per_run integer,
  drip_interval integer,
  drip_interval_unit text DEFAULT 'hours',
  speed_preset text DEFAULT 'natural',
  is_enabled boolean DEFAULT true,
  status text DEFAULT 'pending',
  provider_order_id text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organic_run_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  engagement_order_item_id uuid REFERENCES engagement_order_items(id) ON DELETE CASCADE,
  run_number integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  quantity_to_send integer NOT NULL,
  base_quantity integer NOT NULL,
  variance_applied integer DEFAULT 0,
  peak_multiplier numeric DEFAULT 1.0,
  status text DEFAULT 'pending',
  provider_order_id text,
  provider_response jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  provider_start_count integer,
  provider_remains integer,
  provider_status text,
  provider_charge numeric,
  last_status_check timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  provider_account_name text,
  user_provider_account_id uuid REFERENCES user_provider_accounts(id) ON DELETE SET NULL,
  user_provider_account_name text,
  rotation_lock_key text,
  claim_token uuid,
  claimed_at timestamptz,
  dispatch_uncertain boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_dispatch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  engagement_order_id uuid,
  user_id uuid,
  provider_account_id uuid,
  provider_account_name text,
  event text NOT NULL,
  provider_order_id text,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  balance_after numeric NOT NULL DEFAULT 0,
  order_id uuid,
  description text,
  payment_method text,
  payment_reference text,
  status text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_type text NOT NULL UNIQUE,
  name text NOT NULL,
  price numeric NOT NULL,
  duration_days integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  price_usd numeric,
  price_inr numeric,
  label text,
  sort_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan_type text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'inactive',
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_by uuid
);

CREATE TABLE IF NOT EXISTS subscription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  plan_type text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_type text NOT NULL,
  provider text NOT NULL,
  order_id text NOT NULL UNIQUE,
  amount_usd numeric,
  amount_inr numeric,
  status text NOT NULL DEFAULT 'pending',
  payment_url text,
  activated boolean NOT NULL DEFAULT false,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oxapay_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  track_id text,
  user_id uuid NOT NULL,
  amount_usd numeric(14,2) NOT NULL,
  amount_inr numeric(14,2) NOT NULL,
  pay_currency text,
  status text NOT NULL DEFAULT 'waiting',
  credited boolean NOT NULL DEFAULT false,
  payment_url text,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oxapay_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_hash text NOT NULL UNIQUE,
  order_id text,
  track_id text,
  status text,
  signature_valid boolean NOT NULL DEFAULT false,
  processed boolean NOT NULL DEFAULT false,
  source_ip text,
  payload jsonb,
  credit_result jsonb,
  notes text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zapupi_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id text NOT NULL UNIQUE,
  amount_inr numeric NOT NULL,
  amount_usd numeric,
  status text NOT NULL DEFAULT 'pending',
  credited boolean NOT NULL DEFAULT false,
  txn_id text,
  utr text,
  payment_url text,
  gateway_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  category text DEFAULT 'other',
  priority text DEFAULT 'medium',
  status text DEFAULT 'open',
  order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text NOT NULL,
  user_name text,
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id ON chat_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON chat_conversations (status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_eoi_order ON engagement_order_items (engagement_order_id, id);
CREATE INDEX IF NOT EXISTS idx_eoi_user_bundle_item ON engagement_order_items (user_bundle_item_id) WHERE user_bundle_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eo_user_created ON engagement_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eo_status ON engagement_orders (status);
CREATE INDEX IF NOT EXISTS idx_eo_status_completed_at ON engagement_orders (status, completed_at, updated_at);
CREATE INDEX IF NOT EXISTS engagement_orders_live_queue_idx ON engagement_orders (created_at DESC, id) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_retry ON orders (status, next_retry_at) WHERE status IN ('pending','queued');
CREATE INDEX IF NOT EXISTS idx_orders_processing ON orders (status, last_status_check) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_ors_provider_order_id ON organic_run_schedule (provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ors_upa_started ON organic_run_schedule (user_provider_account_id, started_at DESC) WHERE user_provider_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ors_pa_started ON organic_run_schedule (provider_account_id, started_at DESC) WHERE provider_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ors_item_status ON organic_run_schedule (engagement_order_item_id, status);
CREATE INDEX IF NOT EXISTS organic_run_schedule_item_run_idx ON organic_run_schedule (engagement_order_item_id, run_number);
CREATE INDEX IF NOT EXISTS idx_ors_failed_completed ON organic_run_schedule (completed_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_ors_pending_due ON organic_run_schedule (scheduled_at, last_status_check NULLS FIRST) WHERE status = 'pending' AND engagement_order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ors_started_provider_check ON organic_run_schedule (last_status_check NULLS FIRST) WHERE status = 'started' AND provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organic_run_active_rotation_lock_uidx ON organic_run_schedule (rotation_lock_key)
  WHERE rotation_lock_key IS NOT NULL AND status IN ('dispatching','started','processing','dispatch_uncertain');
CREATE INDEX IF NOT EXISTS organic_run_executor_queue_idx ON organic_run_schedule (scheduled_at, run_number) WHERE status = 'pending' AND provider_order_id IS NULL;
CREATE INDEX IF NOT EXISTS organic_run_status_checker_idx ON organic_run_schedule (last_status_check, updated_at) WHERE status IN ('started','processing') AND provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_dispatch_logs_run_idx ON provider_dispatch_logs (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_dispatch_logs_account_idx ON provider_dispatch_logs (provider_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_dispatch_logs_created_at_idx ON provider_dispatch_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_oxapay_deposits_status ON oxapay_deposits (status);
CREATE INDEX IF NOT EXISTS idx_oxapay_deposits_track ON oxapay_deposits (track_id);
CREATE INDEX IF NOT EXISTS idx_oxapay_deposits_user ON oxapay_deposits (user_id);
CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_active ON provider_accounts (provider_id, is_active);
CREATE INDEX IF NOT EXISTS idx_spm_service_sort ON service_provider_mapping (service_id, sort_order) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_spm_provider_account ON service_provider_mapping (provider_account_id) WHERE provider_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_pay_user ON subscription_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_user_created ON subscription_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_bundle_item_providers_active_idx ON user_bundle_item_providers (user_bundle_item_id, user_id, priority)
  INCLUDE (user_provider_account_id, provider_service_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_ubip_user ON user_bundle_item_providers (user_id);
CREATE INDEX IF NOT EXISTS user_bundle_items_bundle_idx ON user_bundle_items (user_bundle_id, user_id, engagement_type, id);
CREATE INDEX IF NOT EXISTS idx_ub_user ON user_bundles (user_id);
CREATE INDEX IF NOT EXISTS idx_upa_user_active ON user_provider_accounts (user_id, is_active);
CREATE INDEX IF NOT EXISTS user_services_active_mapping_idx ON user_services (user_id, user_provider_account_id, provider_service_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_zapupi_deposits_status ON zapupi_deposits (status);
CREATE INDEX IF NOT EXISTS idx_zapupi_deposits_user ON zapupi_deposits (user_id);

-- ---------------------------------------------------------------------
-- Functions & triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lovable_legacy.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','wallets','providers','provider_accounts','services','service_provider_mapping',
    'user_provider_accounts','user_services','user_bundles','user_bundle_items','user_bundle_item_providers',
    'orders','engagement_orders','engagement_order_items','organic_run_schedule','subscriptions',
    'subscription_requests','subscription_payments','oxapay_deposits','zapupi_deposits','support_tickets']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON lovable_legacy.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON lovable_legacy.%I FOR EACH ROW EXECUTE FUNCTION lovable_legacy.update_updated_at_column()', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION lovable_legacy.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM lovable_legacy.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION lovable_legacy.has_active_subscription(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM lovable_legacy.subscriptions
    WHERE user_id = _user_id AND status = 'active'
      AND plan_type IN ('monthly','yearly','lifetime')
      AND (expires_at IS NULL OR expires_at > now()))
$$;

CREATE OR REPLACE FUNCTION lovable_legacy.is_maintenance_mode() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT maintenance_mode FROM lovable_legacy.platform_settings WHERE id = 'global'), false)
$$;

-- New account: create profile, wallet, role and empty subscription.
CREATE OR REPLACE FUNCTION lovable_legacy.handle_new_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO lovable_legacy.profiles (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', '')) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO lovable_legacy.wallets (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO lovable_legacy.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO lovable_legacy.subscriptions (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON lovable_legacy.auth_users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON lovable_legacy.auth_users
  FOR EACH ROW EXECUTE FUNCTION lovable_legacy.handle_new_user();

CREATE OR REPLACE FUNCTION lovable_legacy.set_engagement_order_completed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at = COALESCE(NEW.completed_at, now());
  ELSIF NEW.status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS set_engagement_order_completed_at_trigger ON lovable_legacy.engagement_orders;
CREATE TRIGGER set_engagement_order_completed_at_trigger BEFORE UPDATE ON lovable_legacy.engagement_orders
  FOR EACH ROW EXECUTE FUNCTION lovable_legacy.set_engagement_order_completed_at();

-- When every run of an item finishes, mark the item done.
CREATE OR REPLACE FUNCTION lovable_legacy.auto_complete_engagement_order_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_all_done boolean; v_delivered integer := 0; v_target integer := 0; v_next text;
BEGIN
  IF NEW.status NOT IN ('completed','partial','failed','cancelled','canceled') OR OLD.status = NEW.status
     OR NEW.engagement_order_item_id IS NULL THEN RETURN NEW; END IF;
  SELECT NOT EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule rs
           WHERE rs.engagement_order_item_id = NEW.engagement_order_item_id
             AND rs.status NOT IN ('completed','partial','failed','cancelled','canceled')),
         COALESCE(SUM(CASE
           WHEN lower(trim(COALESCE(rs.provider_status,''))) IN ('completed','complete','success') THEN rs.quantity_to_send
           WHEN rs.provider_remains IS NOT NULL THEN GREATEST(0, rs.quantity_to_send - rs.provider_remains)
           WHEN rs.status IN ('completed','partial') THEN rs.quantity_to_send ELSE 0 END), 0)
    INTO v_all_done, v_delivered
    FROM lovable_legacy.organic_run_schedule rs WHERE rs.engagement_order_item_id = NEW.engagement_order_item_id;
  IF v_all_done THEN
    SELECT quantity INTO v_target FROM lovable_legacy.engagement_order_items WHERE id = NEW.engagement_order_item_id;
    v_next := CASE WHEN v_target > 0 AND v_delivered >= v_target THEN 'completed'
                   WHEN v_delivered > 0 THEN 'partial' ELSE 'failed' END;
    UPDATE lovable_legacy.engagement_order_items
       SET status = v_next, delivered_count = LEAST(GREATEST(v_delivered,0), GREATEST(v_target,0))
     WHERE id = NEW.engagement_order_item_id AND status NOT IN ('cancelled','canceled');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_complete_order_item ON lovable_legacy.organic_run_schedule;
CREATE TRIGGER trg_auto_complete_order_item AFTER UPDATE ON lovable_legacy.organic_run_schedule
  FOR EACH ROW EXECUTE FUNCTION lovable_legacy.auto_complete_engagement_order_item();

-- When every item of an order finishes, mark the order done.
CREATE OR REPLACE FUNCTION lovable_legacy.auto_complete_engagement_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_total int; v_completed int; v_partial int; v_failed int; v_active int; v_next text;
BEGIN
  IF NEW.status NOT IN ('completed','partial','failed','cancelled','canceled') OR OLD.status = NEW.status THEN RETURN NEW; END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='completed'), COUNT(*) FILTER (WHERE status='partial'),
         COUNT(*) FILTER (WHERE status='failed'),
         COUNT(*) FILTER (WHERE status NOT IN ('completed','partial','failed','cancelled','canceled'))
    INTO v_total, v_completed, v_partial, v_failed, v_active
    FROM lovable_legacy.engagement_order_items WHERE engagement_order_id = NEW.engagement_order_id;
  IF v_total > 0 AND v_active = 0 THEN
    v_next := CASE WHEN v_completed = v_total THEN 'completed'
                   WHEN v_completed > 0 OR v_partial > 0 THEN 'partial'
                   WHEN v_failed > 0 THEN 'failed' ELSE 'cancelled' END;
    UPDATE lovable_legacy.engagement_orders SET status = v_next, completed_at = COALESCE(completed_at, now())
     WHERE id = NEW.engagement_order_id AND status NOT IN ('cancelled','canceled');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_complete_engagement_order ON lovable_legacy.engagement_order_items;
CREATE TRIGGER trg_auto_complete_engagement_order AFTER UPDATE ON lovable_legacy.engagement_order_items
  FOR EACH ROW EXECUTE FUNCTION lovable_legacy.auto_complete_engagement_order();

CREATE OR REPLACE FUNCTION lovable_legacy.update_conversation_last_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lovable_legacy.chat_conversations SET last_message_at = NEW.created_at, updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_new_chat_message ON lovable_legacy.chat_messages;
CREATE TRIGGER on_new_chat_message AFTER INSERT ON lovable_legacy.chat_messages
  FOR EACH ROW EXECUTE FUNCTION lovable_legacy.update_conversation_last_message();

-- Remove finished orders (and their runs) one hour after completion. Call from cron:
--   psql "$DATABASE_URL" -c "SELECT lovable_legacy.cleanup_old_completed_engagement_orders()"
CREATE OR REPLACE FUNCTION lovable_legacy.cleanup_old_completed_engagement_orders() RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_ids uuid[]; v_orders int := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM lovable_legacy.engagement_orders
     WHERE status IN ('completed','cancelled','failed','partial')
       AND COALESCE(completed_at, updated_at, created_at) < now() - interval '1 hour' LIMIT 2000) t;
  IF v_ids IS NULL THEN RETURN json_build_object('deleted_orders', 0); END IF;
  DELETE FROM lovable_legacy.engagement_orders WHERE id = ANY(v_ids);  -- cascades to items and runs
  GET DIAGNOSTICS v_orders = ROW_COUNT;
  RETURN json_build_object('deleted_orders', v_orders, 'ran_at', now());
END; $$;

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------
INSERT INTO platform_settings (id, global_markup_percent, maintenance_mode)
VALUES ('global', 0, false) ON CONFLICT (id) DO NOTHING;

INSERT INTO subscription_plans (plan_type, name, price, price_usd, duration_days, label, sort_order) VALUES
  ('monthly',  'Monthly',  39,  39,  30,   'Monthly',  1),
  ('yearly',   'Yearly',   199, 199, 365,  'Yearly',   2),
  ('lifetime', 'Lifetime', 399, 399, NULL, 'Lifetime', 3)
ON CONFLICT (plan_type) DO NOTHING;

RESET search_path;

-- ---------------------------------------------------------------------
-- App tables in the public schema (used by the dashboard/session API)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"service_id" uuid,
	"link" text NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(14, 4) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"start_count" integer,
	"remains" integer,
	"provider_order_id" text,
	"is_drip_feed" boolean DEFAULT false NOT NULL,
	"drip_runs" integer,
	"drip_interval" integer,
	"drip_interval_unit" text,
	"is_organic_mode" boolean DEFAULT false NOT NULL,
	"variance_percent" integer DEFAULT 25 NOT NULL,
	"peak_hours_enabled" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);

CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);

CREATE TABLE IF NOT EXISTS "public"."profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"api_key" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);

CREATE TABLE IF NOT EXISTS "public"."providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_url" text NOT NULL,
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text,
	"provider_service_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"min_quantity" integer DEFAULT 10 NOT NULL,
	"max_quantity" integer DEFAULT 100000 NOT NULL,
	"speed" text DEFAULT 'medium' NOT NULL,
	"quality" text DEFAULT 'standard' NOT NULL,
	"drip_feed_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"balance_after" numeric(14, 4) NOT NULL,
	"order_id" uuid,
	"description" text,
	"payment_method" text,
	"payment_reference" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "app_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"balance" numeric(14, 4) DEFAULT '0' NOT NULL,
	"total_deposited" numeric(14, 4) DEFAULT '0' NOT NULL,
	"total_spent" numeric(14, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id")
);

DO $$ BEGIN ALTER TABLE public."orders" ADD CONSTRAINT "orders_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public."services" ADD CONSTRAINT "services_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public."support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public."user_roles" ADD CONSTRAINT "user_roles_user_id_unique" UNIQUE("user_id"); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
