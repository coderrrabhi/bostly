
-- Cleanup function for regular orders: delete completed/cancelled/failed/partial older than 24h
CREATE OR REPLACE FUNCTION public.cleanup_old_completed_orders()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_runs INT := 0;
  deleted_orders INT := 0;
BEGIN
  -- Delete organic run schedule rows tied to old finished single orders
  WITH del_runs AS (
    DELETE FROM public.organic_run_schedule
     WHERE order_id IN (
       SELECT id FROM public.orders
        WHERE status IN ('completed','cancelled','failed','partial')
          AND COALESCE(updated_at, created_at) < now() - interval '1 day'
     )
    RETURNING 1
  )
  SELECT count(*) INTO deleted_runs FROM del_runs;

  -- Delete the orders themselves
  WITH del_orders AS (
    DELETE FROM public.orders
     WHERE status IN ('completed','cancelled','failed','partial')
       AND COALESCE(updated_at, created_at) < now() - interval '1 day'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_orders FROM del_orders;

  RETURN json_build_object(
    'deleted_orders', deleted_orders,
    'deleted_runs', deleted_runs,
    'ran_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_completed_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_completed_orders() TO service_role;

-- Ensure pg_cron is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule prior versions (idempotent)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname IN ('cleanup-old-orders-hourly','cleanup-old-engagement-orders-hourly') LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- Hourly cleanup: single orders + engagement orders (both delete >24h old finished rows)
SELECT cron.schedule(
  'cleanup-old-orders-hourly',
  '17 * * * *',
  $$SELECT public.cleanup_old_completed_orders();$$
);

SELECT cron.schedule(
  'cleanup-old-engagement-orders-hourly',
  '37 * * * *',
  $$SELECT public.cleanup_old_completed_engagement_orders();$$
);
