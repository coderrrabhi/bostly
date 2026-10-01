CREATE OR REPLACE FUNCTION public.cleanup_old_completed_engagement_orders()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_runs integer := 0;
  v_items integer := 0;
  v_orders integer := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT eo.id
    FROM public.engagement_orders eo
    WHERE eo.status IN ('completed','cancelled','failed','partial')
      AND COALESCE(eo.completed_at, eo.updated_at, eo.created_at) < now() - interval '1 hour'
    LIMIT 2000
  ) t;

  IF v_ids IS NULL THEN
    RETURN json_build_object('deleted_orders', 0, 'ran_at', now());
  END IF;

  DELETE FROM public.organic_run_schedule rs
  USING public.engagement_order_items eoi
  WHERE rs.engagement_order_item_id = eoi.id
    AND eoi.engagement_order_id = ANY(v_ids);
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  DELETE FROM public.engagement_order_items WHERE engagement_order_id = ANY(v_ids);
  GET DIAGNOSTICS v_items = ROW_COUNT;

  DELETE FROM public.engagement_orders WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  RETURN json_build_object('deleted_orders', v_orders, 'deleted_items', v_items, 'deleted_runs', v_runs, 'ran_at', now());
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_eo_status_completed_at
  ON public.engagement_orders (status, completed_at, updated_at);