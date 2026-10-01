
-- Smart dispatchers: only invoke edge functions when there is real work
CREATE OR REPLACE FUNCTION public.dispatch_execute_all_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due integer;
BEGIN
  SELECT count(*) INTO v_due
  FROM public.organic_run_schedule
  WHERE status = 'pending' AND scheduled_at <= now()
  LIMIT 1;

  IF v_due > 0 THEN
    PERFORM net.http_post(
      url := 'https://ejftttgovinaujrndona.supabase.co/functions/v1/execute-all-runs',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer 9193svPaEmIUHDMKaLY7iXIp0-w8tMUWCqVxYF5iVWyuHu4AYwnan49XvE-4AwlB"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_check_order_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started integer;
BEGIN
  SELECT count(*) INTO v_started
  FROM public.organic_run_schedule
  WHERE status = 'started'
  LIMIT 1;

  IF v_started > 0 THEN
    PERFORM net.http_post(
      url := 'https://ejftttgovinaujrndona.supabase.co/functions/v1/check-order-status',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer 9193svPaEmIUHDMKaLY7iXIp0-w8tMUWCqVxYF5iVWyuHu4AYwnan49XvE-4AwlB"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_check_provider_balance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale integer;
BEGIN
  SELECT count(*) INTO v_stale
  FROM public.user_provider_accounts
  WHERE is_active = true
    AND (balance_checked_at IS NULL OR balance_checked_at < now() - interval '12 hours')
  LIMIT 1;

  IF v_stale > 0 THEN
    PERFORM net.http_post(
      url := 'https://ejftttgovinaujrndona.supabase.co/functions/v1/check-provider-balance',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer 9193svPaEmIUHDMKaLY7iXIp0-w8tMUWCqVxYF5iVWyuHu4AYwnan49XvE-4AwlB"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_execute_all_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_check_order_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_check_provider_balance() FROM PUBLIC, anon, authenticated;

SELECT cron.alter_job(11, command := 'SELECT public.dispatch_execute_all_runs();');
SELECT cron.alter_job(12, command := 'SELECT public.dispatch_check_order_status();');
SELECT cron.alter_job(13, command := 'SELECT public.dispatch_check_provider_balance();');
