
-- ============================================================
-- SUBSCRIPTION GATE: Provider/Bundle creation requires active subscription
-- ============================================================

-- Helper: is user's subscription currently active?
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND status = 'active'
      AND plan_type IN ('monthly','yearly','lifetime')
      AND (expires_at IS NULL OR expires_at > now())
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, anon, service_role;

-- Trigger fn: enforce active subscription for provider add / bundle create
CREATE OR REPLACE FUNCTION public.enforce_subscription_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- service_role / no jwt: skip (server-side ops, admin cron)
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  -- Admins bypass
  IF public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  -- Everyone else needs an active subscription
  IF NOT public.has_active_subscription(v_uid) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: You need an active subscription to perform this action.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gate_user_provider_accounts ON public.user_provider_accounts;
CREATE TRIGGER trg_gate_user_provider_accounts
  BEFORE INSERT ON public.user_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_gate();

DROP TRIGGER IF EXISTS trg_gate_user_bundles ON public.user_bundles;
CREATE TRIGGER trg_gate_user_bundles
  BEFORE INSERT ON public.user_bundles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_gate();

-- Pricing catalog (single row, easy to tweak later)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  plan_type text PRIMARY KEY,
  price_usd numeric NOT NULL,
  price_inr numeric NOT NULL,
  duration_days integer,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read plans" ON public.subscription_plans;
CREATE POLICY "anyone can read plans" ON public.subscription_plans
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admins manage plans" ON public.subscription_plans;
CREATE POLICY "admins manage plans" ON public.subscription_plans
  FOR ALL USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.subscription_plans (plan_type, price_usd, price_inr, duration_days, label, sort_order) VALUES
  ('monthly',  39,  3510,   30, 'Monthly',  1),
  ('yearly',   99,  8910,  365, 'Yearly',   2),
  ('lifetime', 199, 17910, NULL,'Lifetime', 3)
ON CONFLICT (plan_type) DO UPDATE
  SET price_usd = EXCLUDED.price_usd,
      price_inr = EXCLUDED.price_inr,
      duration_days = EXCLUDED.duration_days,
      label = EXCLUDED.label,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

-- Subscription payments trail (links a payment attempt to the plan requested)
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type text NOT NULL,
  provider text NOT NULL, -- 'oxapay' | 'zapupi'
  order_id text NOT NULL UNIQUE,
  amount_usd numeric,
  amount_inr numeric,
  status text NOT NULL DEFAULT 'pending', -- pending|paid|failed
  payment_url text,
  activated boolean NOT NULL DEFAULT false,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own sub payments" ON public.subscription_payments;
CREATE POLICY "users read own sub payments" ON public.subscription_payments
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_sub_pay_user ON public.subscription_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_pay_order ON public.subscription_payments(order_id);

CREATE TRIGGER trg_sub_payments_updated
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC used by webhooks to activate subscription atomically
CREATE OR REPLACE FUNCTION public.activate_subscription_from_payment(p_order_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay record;
  v_days integer;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_pay FROM public.subscription_payments WHERE order_id = p_order_id FOR UPDATE;
  IF v_pay.id IS NULL THEN
    RAISE EXCEPTION 'subscription payment not found: %', p_order_id;
  END IF;

  IF v_pay.activated THEN
    RETURN json_build_object('activated', false, 'duplicate', true);
  END IF;

  SELECT duration_days INTO v_days FROM public.subscription_plans WHERE plan_type = v_pay.plan_type;
  IF v_days IS NULL THEN
    v_expires := NULL; -- lifetime
  ELSE
    v_expires := now() + make_interval(days => v_days);
  END IF;

  INSERT INTO public.subscriptions (user_id, plan_type, status, activated_at, expires_at)
  VALUES (v_pay.user_id, v_pay.plan_type, 'active', now(), v_expires)
  ON CONFLICT (user_id) DO UPDATE
    SET plan_type = EXCLUDED.plan_type,
        status = 'active',
        activated_at = now(),
        expires_at = EXCLUDED.expires_at,
        updated_at = now();

  UPDATE public.subscription_payments
     SET activated = true, status = 'paid', updated_at = now()
   WHERE order_id = p_order_id;

  RETURN json_build_object('activated', true, 'plan_type', v_pay.plan_type, 'expires_at', v_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_subscription_from_payment(text) TO service_role;
