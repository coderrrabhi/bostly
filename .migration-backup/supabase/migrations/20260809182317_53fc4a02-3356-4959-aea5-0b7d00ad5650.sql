-- 1. UNSCHEDULE redundant detect-rotation-violations (handled by compute_rotation_lock_key trigger)
SELECT cron.unschedule(3);

-- 2. RESCHEDULE execute-all-runs: every 1 min → every 3 min
SELECT cron.unschedule(1);
SELECT cron.schedule(
  'execute-all-runs-every-3min',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url:='https://ejftttgovinaujrndona.supabase.co/functions/v1/execute-all-runs',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer 9193svPaEmIUHDMKaLY7iXIp0-w8tMUWCqVxYF5iVWyuHu4AYwnan49XvE-4AwlB"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  );
  $$
);

-- 3. RESCHEDULE check-order-status: every 2 min → every 5 min
SELECT cron.unschedule(2);
SELECT cron.schedule(
  'check-order-status-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://ejftttgovinaujrndona.supabase.co/functions/v1/check-order-status',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer 9193svPaEmIUHDMKaLY7iXIp0-w8tMUWCqVxYF5iVWyuHu4AYwnan49XvE-4AwlB"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  );
  $$
);

-- 4. RESCHEDULE check-provider-balance: every 30 min → every 3 hours
SELECT cron.unschedule(4);
SELECT cron.schedule(
  'check-provider-balance-every-3h',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url:='https://ejftttgovinaujrndona.supabase.co/functions/v1/check-provider-balance',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer 9193svPaEmIUHDMKaLY7iXIp0-w8tMUWCqVxYF5iVWyuHu4AYwnan49XvE-4AwlB"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  );
  $$
);

-- 5. CREATE PostgreSQL trigger: auto-complete order item when all runs finish
CREATE OR REPLACE FUNCTION public.auto_complete_engagement_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_all_done boolean;
  v_delivered integer := 0;
  v_target integer := 0;
BEGIN
  -- Only trigger when a run transitions to completed/failed/cancelled
  IF NEW.status NOT IN ('completed', 'partial', 'failed', 'cancelled', 'canceled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_item_id := NEW.engagement_order_item_id;
  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if ALL runs for this item are in terminal status
  SELECT
    NOT EXISTS (
      SELECT 1 FROM public.organic_run_schedule rs
      WHERE rs.engagement_order_item_id = v_item_id
        AND rs.status NOT IN ('completed', 'partial', 'failed', 'cancelled', 'canceled')
    ),
    COALESCE(SUM(CASE WHEN rs.status IN ('completed','partial') THEN rs.quantity_to_send ELSE 0 END), 0)
  INTO v_all_done, v_delivered
  FROM public.organic_run_schedule rs
  WHERE rs.engagement_order_item_id = v_item_id;

  IF v_all_done THEN
    SELECT target_quantity INTO v_target
    FROM public.engagement_order_items WHERE id = v_item_id;

    UPDATE public.engagement_order_items
    SET status = CASE WHEN v_delivered >= v_target AND v_target > 0 THEN 'completed' ELSE 'partial' END,
        delivered_quantity = v_delivered,
        updated_at = now()
    WHERE id = v_item_id AND status NOT IN ('completed', 'cancelled', 'canceled');
  END IF;

  RETURN NEW;
END;
$$;

-- 6. CREATE PostgreSQL trigger: auto-complete order when all items finish
CREATE OR REPLACE FUNCTION public.auto_complete_engagement_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_all_done boolean;
BEGIN
  -- Only trigger when an item transitions to completed/partial/cancelled/failed
  IF NEW.status NOT IN ('completed', 'partial', 'failed', 'cancelled', 'canceled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_order_id := NEW.engagement_order_id;
  IF v_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if ALL items for this order are in terminal status
  SELECT NOT EXISTS (
    SELECT 1 FROM public.engagement_order_items eoi
    WHERE eoi.engagement_order_id = v_order_id
      AND eoi.status NOT IN ('completed', 'partial', 'failed', 'cancelled', 'canceled')
  )
  INTO v_all_done;

  IF v_all_done THEN
    UPDATE public.engagement_orders
    SET status = 'completed', updated_at = now()
    WHERE id = v_order_id
      AND status NOT IN ('completed', 'cancelled', 'canceled', 'failed');
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Attach trigger to organic_run_schedule (AFTER UPDATE)
DROP TRIGGER IF EXISTS trg_auto_complete_order_item ON public.organic_run_schedule;
CREATE TRIGGER trg_auto_complete_order_item
  AFTER UPDATE ON public.organic_run_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_engagement_order_item();

-- 8. Attach trigger to engagement_order_items (AFTER UPDATE)
DROP TRIGGER IF EXISTS trg_auto_complete_engagement_order ON public.engagement_order_items;
CREATE TRIGGER trg_auto_complete_engagement_order
  AFTER UPDATE ON public.engagement_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_engagement_order();

-- 9. GRANT access
GRANT EXECUTE ON FUNCTION public.auto_complete_engagement_order_item() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_engagement_order() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_engagement_order_item() TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_complete_engagement_order() TO service_role;