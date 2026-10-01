-- Restore missing multi-tenant provider and engagement-order schema.
-- Safe/idempotent: uses IF NOT EXISTS and conditional policy creation.

CREATE TABLE IF NOT EXISTS public.user_provider_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  api_url text NOT NULL,
  api_key_ciphertext text NOT NULL,
  api_key_hint text,
  is_active boolean NOT NULL DEFAULT true,
  balance_cached numeric(14,4),
  balance_currency text,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_provider_accounts TO authenticated;
GRANT ALL ON public.user_provider_accounts TO service_role;
ALTER TABLE public.user_provider_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_provider_accounts' AND policyname='user select own providers') THEN
    CREATE POLICY "user select own providers" ON public.user_provider_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_provider_accounts' AND policyname='user insert own providers') THEN
    CREATE POLICY "user insert own providers" ON public.user_provider_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_provider_accounts' AND policyname='user update own providers') THEN
    CREATE POLICY "user update own providers" ON public.user_provider_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_provider_accounts' AND policyname='user delete own providers') THEN
    CREATE POLICY "user delete own providers" ON public.user_provider_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_upa_user ON public.user_provider_accounts(user_id);
DROP VIEW IF EXISTS public.user_provider_accounts_safe;
CREATE VIEW public.user_provider_accounts_safe WITH (security_invoker = on) AS
  SELECT id, user_id, name, api_url, api_key_hint, is_active,
         balance_cached, balance_currency, last_tested_at, last_test_ok, last_test_error,
         created_at, updated_at
  FROM public.user_provider_accounts;
GRANT SELECT ON public.user_provider_accounts_safe TO authenticated;

CREATE TABLE IF NOT EXISTS public.user_services (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_provider_account_id uuid NOT NULL REFERENCES public.user_provider_accounts(id) ON DELETE CASCADE,
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_services TO authenticated;
GRANT ALL ON public.user_services TO service_role;
ALTER TABLE public.user_services ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_services' AND policyname='user select own services') THEN
    CREATE POLICY "user select own services" ON public.user_services FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_services' AND policyname='user insert own services') THEN
    CREATE POLICY "user insert own services" ON public.user_services FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_services' AND policyname='user update own services') THEN
    CREATE POLICY "user update own services" ON public.user_services FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_services' AND policyname='user delete own services') THEN
    CREATE POLICY "user delete own services" ON public.user_services FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_us_user ON public.user_services(user_id);
CREATE INDEX IF NOT EXISTS idx_us_provider ON public.user_services(user_provider_account_id);
CREATE INDEX IF NOT EXISTS idx_user_services_lookup ON public.user_services(user_provider_account_id, provider_service_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.user_bundles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  platform text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bundles TO authenticated;
GRANT ALL ON public.user_bundles TO service_role;
ALTER TABLE public.user_bundles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundles' AND policyname='user select own bundles') THEN
    CREATE POLICY "user select own bundles" ON public.user_bundles FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundles' AND policyname='user insert own bundles') THEN
    CREATE POLICY "user insert own bundles" ON public.user_bundles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundles' AND policyname='user update own bundles') THEN
    CREATE POLICY "user update own bundles" ON public.user_bundles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundles' AND policyname='user delete own bundles') THEN
    CREATE POLICY "user delete own bundles" ON public.user_bundles FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ub_user ON public.user_bundles(user_id);

CREATE TABLE IF NOT EXISTS public.user_bundle_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_bundle_id uuid NOT NULL REFERENCES public.user_bundles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_service_id uuid REFERENCES public.user_services(id) ON DELETE SET NULL,
  engagement_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 100,
  priority integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bundle_items TO authenticated;
GRANT ALL ON public.user_bundle_items TO service_role;
ALTER TABLE public.user_bundle_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_items' AND policyname='user select own bundle items') THEN
    CREATE POLICY "user select own bundle items" ON public.user_bundle_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_items' AND policyname='user insert own bundle items') THEN
    CREATE POLICY "user insert own bundle items" ON public.user_bundle_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_items' AND policyname='user update own bundle items') THEN
    CREATE POLICY "user update own bundle items" ON public.user_bundle_items FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_items' AND policyname='user delete own bundle items') THEN
    CREATE POLICY "user delete own bundle items" ON public.user_bundle_items FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ubi_bundle ON public.user_bundle_items(user_bundle_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_bundle_items_bundle_type ON public.user_bundle_items(user_bundle_id, engagement_type);

CREATE TABLE IF NOT EXISTS public.user_bundle_item_providers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_bundle_item_id uuid NOT NULL REFERENCES public.user_bundle_items(id) ON DELETE CASCADE,
  user_provider_account_id uuid NOT NULL REFERENCES public.user_provider_accounts(id) ON DELETE CASCADE,
  provider_service_id text,
  priority integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_bundle_item_id, user_provider_account_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bundle_item_providers TO authenticated;
GRANT ALL ON public.user_bundle_item_providers TO service_role;
ALTER TABLE public.user_bundle_item_providers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_item_providers' AND policyname='own bundle item providers - select') THEN
    CREATE POLICY "own bundle item providers - select" ON public.user_bundle_item_providers FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_item_providers' AND policyname='own bundle item providers - insert') THEN
    CREATE POLICY "own bundle item providers - insert" ON public.user_bundle_item_providers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_item_providers' AND policyname='own bundle item providers - update') THEN
    CREATE POLICY "own bundle item providers - update" ON public.user_bundle_item_providers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_bundle_item_providers' AND policyname='own bundle item providers - delete') THEN
    CREATE POLICY "own bundle item providers - delete" ON public.user_bundle_item_providers FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ubip_item ON public.user_bundle_item_providers(user_bundle_item_id);
CREATE INDEX IF NOT EXISTS idx_ubip_user ON public.user_bundle_item_providers(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_bundle_item_providers_unique_enabled_priority
  ON public.user_bundle_item_providers(user_bundle_item_id, priority)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS public.engagement_bundles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  platform text NOT NULL,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  description text,
  icon text DEFAULT 'rocket',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  use_custom_ratios boolean DEFAULT false,
  ai_organic_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.engagement_bundles TO authenticated;
GRANT ALL ON public.engagement_bundles TO service_role;
ALTER TABLE public.engagement_bundles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_bundles' AND policyname='Everyone can view active bundles') THEN
    CREATE POLICY "Everyone can view active bundles" ON public.engagement_bundles FOR SELECT TO authenticated USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_bundles' AND policyname='Admins can manage bundles') THEN
    CREATE POLICY "Admins can manage bundles" ON public.engagement_bundles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bundle_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bundle_id uuid NOT NULL REFERENCES public.engagement_bundles(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
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
GRANT SELECT ON public.bundle_items TO authenticated;
GRANT ALL ON public.bundle_items TO service_role;
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bundle_items' AND policyname='Everyone can view bundle items') THEN
    CREATE POLICY "Everyone can view bundle items" ON public.bundle_items FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bundle_items' AND policyname='Admins can manage bundle items') THEN
    CREATE POLICY "Admins can manage bundle items" ON public.bundle_items FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.engagement_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number bigserial UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle_id uuid REFERENCES public.engagement_bundles(id) ON DELETE SET NULL,
  user_bundle_id uuid REFERENCES public.user_bundles(id) ON DELETE SET NULL,
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
GRANT SELECT, INSERT, UPDATE ON public.engagement_orders TO authenticated;
GRANT ALL ON public.engagement_orders TO service_role;
ALTER TABLE public.engagement_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_orders' AND policyname='Users can view own engagement orders') THEN
    CREATE POLICY "Users can view own engagement orders" ON public.engagement_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_orders' AND policyname='Users can create own engagement orders') THEN
    CREATE POLICY "Users can create own engagement orders" ON public.engagement_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_orders' AND policyname='Users can update own engagement orders') THEN
    CREATE POLICY "Users can update own engagement orders" ON public.engagement_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_orders' AND policyname='Admins can manage all engagement orders') THEN
    CREATE POLICY "Admins can manage all engagement orders" ON public.engagement_orders FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_engagement_orders_user_created ON public.engagement_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_orders_status ON public.engagement_orders(status);

CREATE TABLE IF NOT EXISTS public.engagement_order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_order_id uuid NOT NULL REFERENCES public.engagement_orders(id) ON DELETE CASCADE,
  engagement_type text NOT NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  user_service_id uuid REFERENCES public.user_services(id) ON DELETE SET NULL,
  user_provider_account_id uuid REFERENCES public.user_provider_accounts(id) ON DELETE SET NULL,
  user_bundle_item_id uuid REFERENCES public.user_bundle_items(id) ON DELETE SET NULL,
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
GRANT SELECT, INSERT, UPDATE ON public.engagement_order_items TO authenticated;
GRANT ALL ON public.engagement_order_items TO service_role;
ALTER TABLE public.engagement_order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_order_items' AND policyname='Users can view own engagement order items') THEN
    CREATE POLICY "Users can view own engagement order items" ON public.engagement_order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.engagement_orders eo WHERE eo.id = engagement_order_id AND eo.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_order_items' AND policyname='Users can create own engagement order items') THEN
    CREATE POLICY "Users can create own engagement order items" ON public.engagement_order_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.engagement_orders eo WHERE eo.id = engagement_order_id AND eo.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_order_items' AND policyname='Users can update own engagement order items') THEN
    CREATE POLICY "Users can update own engagement order items" ON public.engagement_order_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.engagement_orders eo WHERE eo.id = engagement_order_id AND eo.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.engagement_orders eo WHERE eo.id = engagement_order_id AND eo.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_order_items' AND policyname='Admins can manage all engagement order items') THEN
    CREATE POLICY "Admins can manage all engagement order items" ON public.engagement_order_items FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_engagement_order_items_order ON public.engagement_order_items(engagement_order_id);
CREATE INDEX IF NOT EXISTS idx_engagement_order_items_user_bundle_item_id ON public.engagement_order_items(user_bundle_item_id) WHERE user_bundle_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.organic_run_schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  engagement_order_item_id uuid REFERENCES public.engagement_order_items(id) ON DELETE CASCADE,
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
  provider_account_id uuid,
  provider_account_name text,
  user_provider_account_id uuid REFERENCES public.user_provider_accounts(id) ON DELETE SET NULL,
  user_provider_account_name text,
  rotation_lock_key text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.organic_run_schedule TO authenticated;
GRANT ALL ON public.organic_run_schedule TO service_role;
ALTER TABLE public.organic_run_schedule ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='organic_run_schedule' AND policyname='Users can view own engagement run schedules') THEN
    CREATE POLICY "Users can view own engagement run schedules" ON public.organic_run_schedule FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM public.engagement_order_items eoi
        JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
        WHERE eoi.id = organic_run_schedule.engagement_order_item_id AND eo.user_id = auth.uid()
      ) OR EXISTS (
        SELECT 1 FROM public.orders o WHERE o.id = organic_run_schedule.order_id AND o.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='organic_run_schedule' AND policyname='Users can create own engagement run schedules') THEN
    CREATE POLICY "Users can create own engagement run schedules" ON public.organic_run_schedule FOR INSERT TO authenticated WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.engagement_order_items eoi
        JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
        WHERE eoi.id = organic_run_schedule.engagement_order_item_id AND eo.user_id = auth.uid()
      ) OR EXISTS (
        SELECT 1 FROM public.orders o WHERE o.id = organic_run_schedule.order_id AND o.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='organic_run_schedule' AND policyname='Users can update own engagement run schedules') THEN
    CREATE POLICY "Users can update own engagement run schedules" ON public.organic_run_schedule FOR UPDATE TO authenticated USING (
      EXISTS (
        SELECT 1 FROM public.engagement_order_items eoi
        JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
        WHERE eoi.id = organic_run_schedule.engagement_order_item_id AND eo.user_id = auth.uid()
      ) OR EXISTS (
        SELECT 1 FROM public.orders o WHERE o.id = organic_run_schedule.order_id AND o.user_id = auth.uid()
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.engagement_order_items eoi
        JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
        WHERE eoi.id = organic_run_schedule.engagement_order_item_id AND eo.user_id = auth.uid()
      ) OR EXISTS (
        SELECT 1 FROM public.orders o WHERE o.id = organic_run_schedule.order_id AND o.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='organic_run_schedule' AND policyname='Admins can manage all runs') THEN
    CREATE POLICY "Admins can manage all runs" ON public.organic_run_schedule FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_organic_run_schedule_engagement_item ON public.organic_run_schedule(engagement_order_item_id);
CREATE INDEX IF NOT EXISTS idx_organic_run_schedule_status_due ON public.organic_run_schedule(status, scheduled_at) WHERE engagement_order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organic_run_schedule_status_check ON public.organic_run_schedule(status, last_status_check);
CREATE INDEX IF NOT EXISTS idx_organic_run_schedule_user_provider_account_id ON public.organic_run_schedule(user_provider_account_id) WHERE user_provider_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_rotation_lock ON public.organic_run_schedule(rotation_lock_key) WHERE rotation_lock_key IS NOT NULL;

-- Updated-at triggers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='upa_updated_at') THEN
    CREATE TRIGGER upa_updated_at BEFORE UPDATE ON public.user_provider_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='us_updated_at') THEN
    CREATE TRIGGER us_updated_at BEFORE UPDATE ON public.user_services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ub_updated_at') THEN
    CREATE TRIGGER ub_updated_at BEFORE UPDATE ON public.user_bundles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ubi_updated_at') THEN
    CREATE TRIGGER ubi_updated_at BEFORE UPDATE ON public.user_bundle_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_ubip_updated_at') THEN
    CREATE TRIGGER trg_ubip_updated_at BEFORE UPDATE ON public.user_bundle_item_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_engagement_orders_updated_at') THEN
    CREATE TRIGGER update_engagement_orders_updated_at BEFORE UPDATE ON public.engagement_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_engagement_order_items_updated_at') THEN
    CREATE TRIGGER update_engagement_order_items_updated_at BEFORE UPDATE ON public.engagement_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_engagement_order_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    NEW.completed_at = COALESCE(NEW.completed_at, now());
  ELSIF NEW.status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS set_engagement_order_completed_at_trigger ON public.engagement_orders;
CREATE TRIGGER set_engagement_order_completed_at_trigger
BEFORE UPDATE ON public.engagement_orders
FOR EACH ROW EXECUTE FUNCTION public.set_engagement_order_completed_at();

CREATE OR REPLACE FUNCTION public.compute_rotation_lock_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link text;
  v_type text;
  v_provider_key text;
  v_lock_key text;
  v_lock_exists boolean := false;
BEGIN
  IF NEW.status = 'started'
     AND NEW.engagement_order_item_id IS NOT NULL
     AND (NEW.provider_account_id IS NOT NULL OR NEW.user_provider_account_id IS NOT NULL) THEN

    SELECT lower(btrim(eo.link)), lower(btrim(eoi.engagement_type))
      INTO v_link, v_type
    FROM public.engagement_order_items eoi
    JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
    WHERE eoi.id = NEW.engagement_order_item_id;

    IF NEW.user_provider_account_id IS NOT NULL THEN
      v_provider_key := 'user:' || NEW.user_provider_account_id::text;
    ELSE
      v_provider_key := 'admin:' || NEW.provider_account_id::text;
    END IF;

    IF v_link IS NOT NULL AND v_type IS NOT NULL AND v_link <> '' AND v_type <> '' THEN
      v_lock_key := v_link || '||' || v_type || '||' || v_provider_key;
      IF NEW.provider_order_id IS NULL THEN
        NEW.rotation_lock_key := v_lock_key;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.organic_run_schedule ors
          WHERE ors.id <> NEW.id
            AND ors.status = 'started'
            AND ors.rotation_lock_key = v_lock_key
        ) INTO v_lock_exists;
        IF v_lock_exists AND COALESCE(OLD.rotation_lock_key, '') <> v_lock_key THEN
          NEW.rotation_lock_key := NULL;
        ELSE
          NEW.rotation_lock_key := v_lock_key;
        END IF;
      END IF;
    ELSE
      NEW.rotation_lock_key := NULL;
    END IF;
  ELSE
    NEW.rotation_lock_key := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_compute_rotation_lock_key ON public.organic_run_schedule;
CREATE TRIGGER trg_compute_rotation_lock_key
BEFORE INSERT OR UPDATE OF status, provider_order_id, provider_account_id, user_provider_account_id, engagement_order_item_id
ON public.organic_run_schedule
FOR EACH ROW EXECUTE FUNCTION public.compute_rotation_lock_key();

-- Subscription hard gate: users need an active subscription to add providers/bundles/mappings.
CREATE OR REPLACE FUNCTION public.enforce_active_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role')
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NOT public.has_active_subscription(v_uid) THEN
    RAISE EXCEPTION 'Active subscription required. Subscribe via ZapUPI, Crypto (OxaPay), or contact admin for manual activation.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_sub_user_provider_accounts ON public.user_provider_accounts;
CREATE TRIGGER tr_enforce_sub_user_provider_accounts BEFORE INSERT ON public.user_provider_accounts FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();
DROP TRIGGER IF EXISTS tr_enforce_sub_user_bundles ON public.user_bundles;
CREATE TRIGGER tr_enforce_sub_user_bundles BEFORE INSERT ON public.user_bundles FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();
DROP TRIGGER IF EXISTS tr_enforce_sub_user_bundle_items ON public.user_bundle_items;
CREATE TRIGGER tr_enforce_sub_user_bundle_items BEFORE INSERT ON public.user_bundle_items FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();
DROP TRIGGER IF EXISTS tr_enforce_sub_user_bundle_item_providers ON public.user_bundle_item_providers;
CREATE TRIGGER tr_enforce_sub_user_bundle_item_providers BEFORE INSERT ON public.user_bundle_item_providers FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

-- Disable destructive history cleanup permanently: keep history visible.
CREATE OR REPLACE FUNCTION public.cleanup_old_completed_engagement_orders()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN json_build_object(
    'disabled', true,
    'message', 'History cleanup is disabled; engagement order history is retained.',
    'ran_at', now()
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('cleanup-old-engagement-orders-hourly', 'cleanup-old-orders-hourly');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_rotation_lock_key() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_active_subscription() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_completed_engagement_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_completed_engagement_orders() TO service_role;