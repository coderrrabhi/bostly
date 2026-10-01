
-- ============================================================
-- Per-User Provider System
-- ============================================================

-- 1) User Provider Accounts (their own SMM panel API keys)
CREATE TABLE public.user_provider_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,     -- encrypted server-side (edge function)
  api_key_hint TEXT,                    -- last 4 chars for UI display
  is_active BOOLEAN NOT NULL DEFAULT true,
  balance_cached NUMERIC(14,4),
  balance_currency TEXT,
  last_tested_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_upa_user ON public.user_provider_accounts(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_provider_accounts TO authenticated;
GRANT ALL ON public.user_provider_accounts TO service_role;
ALTER TABLE public.user_provider_accounts ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own rows. Ciphertext column stays server-only readable.
CREATE POLICY "user select own providers" ON public.user_provider_accounts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user insert own providers" ON public.user_provider_accounts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user update own providers" ON public.user_provider_accounts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user delete own providers" ON public.user_provider_accounts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Safe view without ciphertext for client reads (defence in depth)
CREATE VIEW public.user_provider_accounts_safe
WITH (security_invoker = on) AS
  SELECT id, user_id, name, api_url, api_key_hint, is_active,
         balance_cached, balance_currency, last_tested_at, last_test_ok, last_test_error,
         created_at, updated_at
    FROM public.user_provider_accounts;
GRANT SELECT ON public.user_provider_accounts_safe TO authenticated;

CREATE TRIGGER upa_updated_at BEFORE UPDATE ON public.user_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) User Services (imported from their panel)
CREATE TABLE public.user_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_provider_account_id UUID NOT NULL REFERENCES public.user_provider_accounts(id) ON DELETE CASCADE,
  provider_service_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  type TEXT,
  rate NUMERIC(14,4) NOT NULL DEFAULT 0,        -- price per 1000 (as provider returns)
  min_quantity INTEGER NOT NULL DEFAULT 1,
  max_quantity INTEGER NOT NULL DEFAULT 1000000,
  refill BOOLEAN NOT NULL DEFAULT false,
  cancel_allowed BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_provider_account_id, provider_service_id)
);
CREATE INDEX idx_us_user ON public.user_services(user_id);
CREATE INDEX idx_us_provider ON public.user_services(user_provider_account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_services TO authenticated;
GRANT ALL ON public.user_services TO service_role;
ALTER TABLE public.user_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user select own services" ON public.user_services
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user insert own services" ON public.user_services
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user update own services" ON public.user_services
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user delete own services" ON public.user_services
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER us_updated_at BEFORE UPDATE ON public.user_services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) User Bundles
CREATE TABLE public.user_bundles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  platform TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ub_user ON public.user_bundles(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bundles TO authenticated;
GRANT ALL ON public.user_bundles TO service_role;
ALTER TABLE public.user_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user select own bundles" ON public.user_bundles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user insert own bundles" ON public.user_bundles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user update own bundles" ON public.user_bundles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user delete own bundles" ON public.user_bundles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER ub_updated_at BEFORE UPDATE ON public.user_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) User Bundle Items
CREATE TABLE public.user_bundle_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_bundle_id UUID NOT NULL REFERENCES public.user_bundles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_service_id UUID NOT NULL REFERENCES public.user_services(id) ON DELETE RESTRICT,
  engagement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ubi_bundle ON public.user_bundle_items(user_bundle_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bundle_items TO authenticated;
GRANT ALL ON public.user_bundle_items TO service_role;
ALTER TABLE public.user_bundle_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user select own bundle items" ON public.user_bundle_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user insert own bundle items" ON public.user_bundle_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user update own bundle items" ON public.user_bundle_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user delete own bundle items" ON public.user_bundle_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER ubi_updated_at BEFORE UPDATE ON public.user_bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Extend orders / engagement_orders to reference user's own provider (optional)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS user_provider_account_id UUID REFERENCES public.user_provider_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_service_id UUID REFERENCES public.user_services(id) ON DELETE SET NULL;

ALTER TABLE public.engagement_orders
  ADD COLUMN IF NOT EXISTS user_bundle_id UUID REFERENCES public.user_bundles(id) ON DELETE SET NULL;

ALTER TABLE public.engagement_order_items
  ADD COLUMN IF NOT EXISTS user_provider_account_id UUID REFERENCES public.user_provider_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_service_id UUID REFERENCES public.user_services(id) ON DELETE SET NULL;
