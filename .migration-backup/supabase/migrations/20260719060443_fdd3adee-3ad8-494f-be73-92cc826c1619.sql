-- Align restored schema with current frontend/backend expectations.

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS provider_service_id text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS speed text DEFAULT 'medium';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS quality text DEFAULT 'standard';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS drip_feed_enabled boolean NOT NULL DEFAULT true;
UPDATE public.services SET provider_service_id = COALESCE(provider_service_id, id::text) WHERE provider_service_id IS NULL;
ALTER TABLE public.services ALTER COLUMN provider_service_id SET NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT SELECT ON public.services TO anon;
GRANT ALL ON public.services TO service_role;

ALTER TABLE public.provider_accounts ADD COLUMN IF NOT EXISTS balance numeric;
UPDATE public.provider_accounts SET balance = COALESCE(balance, balance_cached, 0);
ALTER TABLE public.provider_accounts ALTER COLUMN balance SET DEFAULT 0;

ALTER TABLE public.service_provider_mapping ALTER COLUMN provider_id DROP NOT NULL;
ALTER TABLE public.service_provider_mapping ALTER COLUMN min_quantity DROP NOT NULL;
ALTER TABLE public.service_provider_mapping ALTER COLUMN max_quantity DROP NOT NULL;
ALTER TABLE public.service_provider_mapping ALTER COLUMN priority DROP NOT NULL;

ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_usd numeric;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_inr numeric;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
UPDATE public.subscription_plans
SET price_usd = COALESCE(price_usd, price),
    price_inr = COALESCE(price_inr, price * 90),
    label = COALESCE(label, name),
    sort_order = COALESCE(sort_order,
      CASE plan_type WHEN 'monthly' THEN 1 WHEN 'yearly' THEN 2 WHEN 'lifetime' THEN 3 ELSE 99 END
    );
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

CREATE OR REPLACE FUNCTION public.reschedule_organic_run(p_run_id uuid, p_delay_minutes integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run record;
BEGIN
  SELECT * INTO v_run FROM public.organic_run_schedule WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Run not found';
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF v_run.engagement_order_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.engagement_orders eo
      WHERE eo.id = v_run.engagement_order_id AND eo.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  UPDATE public.organic_run_schedule
  SET status = 'pending',
      scheduled_at = now() + make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 30), 1)),
      error_message = NULL,
      retry_count = COALESCE(retry_count, 0) + 1,
      provider_order_id = NULL,
      provider_response = NULL,
      provider_account_id = NULL,
      user_provider_account_id = NULL,
      rotation_lock_key = NULL,
      updated_at = now()
  WHERE id = p_run_id;

  RETURN json_build_object('success', true, 'run_id', p_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_provider_topup_breakdown()
RETURNS TABLE(
  provider_id text,
  provider_name text,
  service_id text,
  service_name text,
  service_category text,
  pending_runs bigint,
  pending_quantity bigint,
  pending_user_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(upa.name, pa.provider_id, 'user-provider')::text AS provider_id,
    COALESCE(upa.name, pa.name, 'User provider')::text AS provider_name,
    COALESCE(s.id::text, ubi.id::text, eoi.service_id::text) AS service_id,
    COALESCE(s.name, eoi.engagement_type, 'Engagement')::text AS service_name,
    COALESCE(s.category, eoi.engagement_type, 'engagement')::text AS service_category,
    COUNT(rs.id)::bigint AS pending_runs,
    COALESCE(SUM(rs.quantity_to_send), 0)::bigint AS pending_quantity,
    ROUND(COALESCE(SUM((rs.quantity_to_send::numeric / 1000.0) * COALESCE(s.price, 0)), 0), 4)::numeric AS pending_user_usd
  FROM public.organic_run_schedule rs
  LEFT JOIN public.engagement_order_items eoi ON eoi.id = rs.engagement_order_item_id
  LEFT JOIN public.user_bundle_item_providers ubip ON ubip.id = rs.user_bundle_item_provider_id
  LEFT JOIN public.user_provider_accounts upa ON upa.id = COALESCE(rs.user_provider_account_id, ubip.user_provider_account_id)
  LEFT JOIN public.user_bundle_items ubi ON ubi.id = eoi.user_bundle_item_id
  LEFT JOIN public.services s ON s.id = COALESCE(eoi.service_id, rs.service_id)
  LEFT JOIN public.provider_accounts pa ON pa.id = rs.provider_account_id
  WHERE rs.status IN ('pending', 'processing', 'retry')
  GROUP BY COALESCE(upa.name, pa.provider_id, 'user-provider'), COALESCE(upa.name, pa.name, 'User provider'), COALESCE(s.id::text, ubi.id::text, eoi.service_id::text), COALESCE(s.name, eoi.engagement_type, 'Engagement'), COALESCE(s.category, eoi.engagement_type, 'engagement')
  ORDER BY pending_user_usd DESC, pending_runs DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_pending_users(p_limit integer DEFAULT 5)
RETURNS TABLE(
  user_id uuid,
  email text,
  full_name text,
  wallet_balance numeric,
  total_deposited numeric,
  total_spent numeric,
  pending_orders bigint,
  pending_value_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    eo.user_id,
    COALESCE(p.email, '')::text,
    COALESCE(p.full_name, '')::text,
    COALESCE(w.balance, 0)::numeric,
    COALESCE(w.total_deposited, 0)::numeric,
    COALESCE(w.total_spent, 0)::numeric,
    COUNT(DISTINCT eo.id)::bigint,
    ROUND(COALESCE(SUM((rs.quantity_to_send::numeric / 1000.0) * COALESCE(s.price, 0)), 0), 4)::numeric
  FROM public.engagement_orders eo
  JOIN public.engagement_order_items eoi ON eoi.engagement_order_id = eo.id
  JOIN public.organic_run_schedule rs ON rs.engagement_order_item_id = eoi.id
  LEFT JOIN public.services s ON s.id = eoi.service_id
  LEFT JOIN public.profiles p ON p.user_id = eo.user_id
  LEFT JOIN public.wallets w ON w.user_id = eo.user_id
  WHERE rs.status IN ('pending', 'processing', 'retry')
  GROUP BY eo.user_id, p.email, p.full_name, w.balance, w.total_deposited, w.total_spent
  ORDER BY pending_value_usd DESC, pending_orders DESC
  LIMIT GREATEST(COALESCE(p_limit, 5), 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_organic_run(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_organic_run(uuid, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_provider_topup_breakdown() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_topup_breakdown() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_top_pending_users(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_pending_users(integer) TO authenticated, service_role;