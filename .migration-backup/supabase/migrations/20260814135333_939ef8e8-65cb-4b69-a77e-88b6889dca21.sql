CREATE OR REPLACE FUNCTION public.auto_complete_engagement_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item_id uuid;
  v_all_done boolean;
  v_delivered integer := 0;
  v_target integer := 0;
  v_next_status text;
BEGIN
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

  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.organic_run_schedule rs
      WHERE rs.engagement_order_item_id = v_item_id
        AND rs.status NOT IN ('completed', 'partial', 'failed', 'cancelled', 'canceled')
    ),
    COALESCE(SUM(
      CASE
        WHEN lower(trim(COALESCE(rs.provider_status, ''))) IN ('completed', 'complete', 'success') THEN rs.quantity_to_send
        WHEN rs.provider_remains IS NOT NULL THEN GREATEST(0, rs.quantity_to_send - rs.provider_remains)
        WHEN rs.status IN ('completed', 'partial') THEN rs.quantity_to_send
        ELSE 0
      END
    ), 0)
  INTO v_all_done, v_delivered
  FROM public.organic_run_schedule rs
  WHERE rs.engagement_order_item_id = v_item_id;

  IF v_all_done THEN
    SELECT quantity INTO v_target
    FROM public.engagement_order_items
    WHERE id = v_item_id;

    v_next_status := CASE
      WHEN v_target > 0 AND v_delivered >= v_target THEN 'completed'
      WHEN v_delivered > 0 THEN 'partial'
      ELSE 'failed'
    END;

    UPDATE public.engagement_order_items
    SET status = v_next_status,
        delivered_count = LEAST(GREATEST(v_delivered, 0), GREATEST(v_target, 0)),
        updated_at = now()
    WHERE id = v_item_id
      AND status NOT IN ('cancelled', 'canceled');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_complete_engagement_order_item() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_engagement_order_item() TO service_role;

CREATE OR REPLACE FUNCTION public.auto_complete_engagement_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_total integer;
  v_completed integer;
  v_partial integer;
  v_failed integer;
  v_cancelled integer;
  v_active integer;
  v_next_status text;
BEGIN
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

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'partial'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status IN ('cancelled', 'canceled')),
    COUNT(*) FILTER (WHERE status NOT IN ('completed', 'partial', 'failed', 'cancelled', 'canceled'))
  INTO v_total, v_completed, v_partial, v_failed, v_cancelled, v_active
  FROM public.engagement_order_items
  WHERE engagement_order_id = v_order_id;

  IF v_total > 0 AND v_active = 0 THEN
    v_next_status := CASE
      WHEN v_completed = v_total THEN 'completed'
      WHEN v_completed > 0 OR v_partial > 0 THEN 'partial'
      WHEN v_failed > 0 THEN 'failed'
      ELSE 'cancelled'
    END;

    UPDATE public.engagement_orders
    SET status = v_next_status,
        completed_at = CASE WHEN v_next_status IN ('completed', 'partial', 'failed', 'cancelled') THEN COALESCE(completed_at, now()) ELSE completed_at END,
        updated_at = now()
    WHERE id = v_order_id
      AND status NOT IN ('cancelled', 'canceled');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_complete_engagement_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_engagement_order() TO service_role;