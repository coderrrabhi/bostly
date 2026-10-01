
-- Hard security: block provider/bundle creation unless user has active subscription OR is admin.
-- Also block ALL client-side writes to subscriptions table (only SECURITY DEFINER RPCs + service_role allowed).

CREATE OR REPLACE FUNCTION public.enforce_active_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Service role / superuser bypass (edge functions with service key)
  IF current_user IN ('postgres','supabase_admin','service_role')
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Admins bypass
  IF public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Enforce subscription
  IF NOT public.has_active_subscription(v_uid) THEN
    RAISE EXCEPTION 'Active subscription required. Subscribe via ZapUPI, Crypto (OxaPay), or contact admin for manual activation.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach to provider/bundle tables (INSERT only — existing rows unaffected)
DROP TRIGGER IF EXISTS tr_enforce_sub_user_provider_accounts ON public.user_provider_accounts;
CREATE TRIGGER tr_enforce_sub_user_provider_accounts
  BEFORE INSERT ON public.user_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

DROP TRIGGER IF EXISTS tr_enforce_sub_user_bundles ON public.user_bundles;
CREATE TRIGGER tr_enforce_sub_user_bundles
  BEFORE INSERT ON public.user_bundles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

DROP TRIGGER IF EXISTS tr_enforce_sub_user_bundle_items ON public.user_bundle_items;
CREATE TRIGGER tr_enforce_sub_user_bundle_items
  BEFORE INSERT ON public.user_bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

DROP TRIGGER IF EXISTS tr_enforce_sub_user_bundle_item_providers ON public.user_bundle_item_providers;
CREATE TRIGGER tr_enforce_sub_user_bundle_item_providers
  BEFORE INSERT ON public.user_bundle_item_providers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

-- Tamper-proof subscriptions: block any non-service, non-admin write. This ensures a user
-- cannot bypass by directly INSERT/UPDATE-ing subscriptions even if RLS is later loosened.
CREATE OR REPLACE FUNCTION public.guard_subscription_write()
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
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'Forbidden: subscriptions can only be modified by admin, OxaPay, ZapUPI, or backend.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_subscription_write ON public.subscriptions;
CREATE TRIGGER tr_guard_subscription_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_write();
