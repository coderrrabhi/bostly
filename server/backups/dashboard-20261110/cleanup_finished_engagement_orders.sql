CREATE OR REPLACE FUNCTION lovable_legacy.cleanup_finished_engagement_orders()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'lovable_legacy'
AS $function$
DECLARE d_runs int := 0; d_items int := 0; d_orders int := 0;
BEGIN
  WITH t AS (SELECT id FROM engagement_orders WHERE status IN ('completed','cancelled','failed','partial')),
  r AS (DELETE FROM organic_run_schedule WHERE order_id IN (SELECT id FROM t)
        OR engagement_order_item_id IN (SELECT i.id FROM engagement_order_items i JOIN t ON t.id=i.engagement_order_id) RETURNING 1)
  SELECT count(*) INTO d_runs FROM r;
  WITH i AS (DELETE FROM engagement_order_items WHERE engagement_order_id IN
        (SELECT id FROM engagement_orders WHERE status IN ('completed','cancelled','failed','partial')) RETURNING 1)
  SELECT count(*) INTO d_items FROM i;
  WITH o AS (DELETE FROM engagement_orders WHERE status IN ('completed','cancelled','failed','partial') RETURNING 1)
  SELECT count(*) INTO d_orders FROM o;
  RETURN json_build_object('deleted_runs',d_runs,'deleted_items',d_items,'deleted_orders',d_orders,'ran_at',now());
END $function$

