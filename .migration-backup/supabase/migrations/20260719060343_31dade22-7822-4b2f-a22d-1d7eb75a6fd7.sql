-- Restore remaining application tables and admin-provider rotation schema.

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  total_deposited numeric NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='wallets' AND policyname='Users can view own wallet') THEN
    CREATE POLICY "Users can view own wallet" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='wallets' AND policyname='Users can insert own wallet') THEN
    CREATE POLICY "Users can insert own wallet" ON public.wallets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='wallets' AND policyname='Users can update own wallet') THEN
    CREATE POLICY "Users can update own wallet" ON public.wallets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='wallets' AND policyname='Admins can manage all wallets') THEN
    CREATE POLICY "Admins can manage all wallets" ON public.wallets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.transactions (
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
GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='transactions' AND policyname='Users can view own transactions') THEN
    CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='transactions' AND policyname='Users can create own transactions') THEN
    CREATE POLICY "Users can create own transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='transactions' AND policyname='Admins can manage all transactions') THEN
    CREATE POLICY "Admins can manage all transactions" ON public.transactions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_tickets (
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
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='Users can view own tickets') THEN
    CREATE POLICY "Users can view own tickets" ON public.support_tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='Users can create own tickets') THEN
    CREATE POLICY "Users can create own tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='Users can update own tickets') THEN
    CREATE POLICY "Users can update own tickets" ON public.support_tickets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='support_tickets' AND policyname='Admins can manage all tickets') THEN
    CREATE POLICY "Admins can manage all tickets" ON public.support_tickets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.provider_accounts (
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
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_accounts TO authenticated;
GRANT ALL ON public.provider_accounts TO service_role;
ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='provider_accounts' AND policyname='Admins can manage provider accounts') THEN
    CREATE POLICY "Admins can manage provider accounts" ON public.provider_accounts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_active ON public.provider_accounts(provider_id, is_active);

ALTER TABLE public.service_provider_mapping ADD COLUMN IF NOT EXISTS provider_account_id uuid REFERENCES public.provider_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.service_provider_mapping ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_mapping TO authenticated;
GRANT ALL ON public.service_provider_mapping TO service_role;
CREATE INDEX IF NOT EXISTS idx_spm_provider_account ON public.service_provider_mapping(provider_account_id) WHERE provider_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spm_service_sort ON public.service_provider_mapping(service_id, sort_order) WHERE is_active = true;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='service_provider_mapping' AND policyname='Admins can manage service mappings') THEN
    CREATE POLICY "Admins can manage service mappings" ON public.service_provider_mapping FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id text PRIMARY KEY DEFAULT 'global',
  global_markup_percent numeric NOT NULL DEFAULT 0,
  maintenance_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.platform_settings TO anon, authenticated;
GRANT UPDATE, INSERT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.platform_settings (id, global_markup_percent, maintenance_mode) VALUES ('global', 0, false)
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_settings' AND policyname='Anyone can read platform settings') THEN
    CREATE POLICY "Anyone can read platform settings" ON public.platform_settings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_settings' AND policyname='Only admins can update platform settings') THEN
    CREATE POLICY "Only admins can update platform settings" ON public.platform_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_settings' AND policyname='Only admins can insert platform settings') THEN
    CREATE POLICY "Only admins can insert platform settings" ON public.platform_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.subscription_requests (
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
GRANT SELECT, INSERT, UPDATE ON public.subscription_requests TO authenticated;
GRANT ALL ON public.subscription_requests TO service_role;
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscription_requests' AND policyname='Users can view own requests') THEN
    CREATE POLICY "Users can view own requests" ON public.subscription_requests FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscription_requests' AND policyname='Users can create own requests') THEN
    CREATE POLICY "Users can create own requests" ON public.subscription_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscription_requests' AND policyname='Admins can manage all requests') THEN
    CREATE POLICY "Admins can manage all requests" ON public.subscription_requests FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_subscription_requests_user_created ON public.subscription_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.subscription_payments (
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
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscription_payments' AND policyname='users read own sub payments') THEN
    CREATE POLICY "users read own sub payments" ON public.subscription_payments FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sub_pay_user ON public.subscription_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_pay_order ON public.subscription_payments(order_id);

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text NOT NULL,
  user_name text,
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_conversations' AND policyname='Users can view their own conversations') THEN
    CREATE POLICY "Users can view their own conversations" ON public.chat_conversations FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_conversations' AND policyname='Users can create their own conversations') THEN
    CREATE POLICY "Users can create their own conversations" ON public.chat_conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_conversations' AND policyname='Users can update their own conversations') THEN
    CREATE POLICY "Users can update their own conversations" ON public.chat_conversations FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id ON public.chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON public.chat_conversations(status);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can view messages in their conversations') THEN
    CREATE POLICY "Users can view messages in their conversations" ON public.chat_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id = conversation_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can create messages in their conversations') THEN
    CREATE POLICY "Users can create messages in their conversations" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id = conversation_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Admins can update messages') THEN
    CREATE POLICY "Admins can update messages" ON public.chat_messages FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON public.chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at);

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_conversations
  SET last_message_at = NEW.created_at, updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_new_chat_message ON public.chat_messages;
CREATE TRIGGER on_new_chat_message AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.update_conversation_last_message();

CREATE TABLE IF NOT EXISTS public.zapupi_deposits (
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
GRANT SELECT ON public.zapupi_deposits TO authenticated;
GRANT ALL ON public.zapupi_deposits TO service_role;
ALTER TABLE public.zapupi_deposits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zapupi_deposits' AND policyname='Users view own zapupi deposits') THEN
    CREATE POLICY "Users view own zapupi deposits" ON public.zapupi_deposits FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_zapupi_deposits_user ON public.zapupi_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_zapupi_deposits_status ON public.zapupi_deposits(status);

CREATE TABLE IF NOT EXISTS public.oxapay_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text UNIQUE NOT NULL,
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
GRANT SELECT ON public.oxapay_deposits TO authenticated;
GRANT ALL ON public.oxapay_deposits TO service_role;
ALTER TABLE public.oxapay_deposits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oxapay_deposits' AND policyname='Users see own oxapay deposits') THEN
    CREATE POLICY "Users see own oxapay deposits" ON public.oxapay_deposits FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_oxapay_deposits_user ON public.oxapay_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_oxapay_deposits_status ON public.oxapay_deposits(status);
CREATE INDEX IF NOT EXISTS idx_oxapay_deposits_track ON public.oxapay_deposits(track_id);

CREATE TABLE IF NOT EXISTS public.oxapay_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_hash text UNIQUE NOT NULL,
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
GRANT SELECT ON public.oxapay_webhook_events TO authenticated;
GRANT ALL ON public.oxapay_webhook_events TO service_role;
ALTER TABLE public.oxapay_webhook_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oxapay_webhook_events' AND policyname='Admins read oxapay events') THEN
    CREATE POLICY "Admins read oxapay events" ON public.oxapay_webhook_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_maintenance_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT maintenance_mode FROM public.platform_settings WHERE id = 'global' LIMIT 1), false)
$$;

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
  SELECT duration_days INTO v_days FROM public.subscription_plans WHERE plan_type = v_pay.plan_type LIMIT 1;
  IF v_pay.plan_type = 'lifetime' OR v_days IS NULL THEN
    v_expires := NULL;
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
  UPDATE public.subscription_payments SET activated = true, status = 'paid', updated_at = now() WHERE order_id = p_order_id;
  RETURN json_build_object('activated', true, 'plan_type', v_pay.plan_type, 'expires_at', v_expires);
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_wallets_updated_at') THEN
    CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_tickets_updated_at') THEN
    CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_provider_accounts_updated_at') THEN
    CREATE TRIGGER update_provider_accounts_updated_at BEFORE UPDATE ON public.provider_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_subscription_requests_updated_at') THEN
    CREATE TRIGGER update_subscription_requests_updated_at BEFORE UPDATE ON public.subscription_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_sub_payments_updated') THEN
    CREATE TRIGGER trg_sub_payments_updated BEFORE UPDATE ON public.subscription_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_zapupi_deposits_updated') THEN
    CREATE TRIGGER trg_zapupi_deposits_updated BEFORE UPDATE ON public.zapupi_deposits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_oxapay_deposits_updated') THEN
    CREATE TRIGGER trg_oxapay_deposits_updated BEFORE UPDATE ON public.oxapay_deposits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.update_conversation_last_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_subscription_from_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription_from_payment(text) TO service_role;