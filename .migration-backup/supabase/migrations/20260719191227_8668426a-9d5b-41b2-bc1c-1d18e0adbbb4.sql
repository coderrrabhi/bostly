
CREATE OR REPLACE FUNCTION public.reschedule_organic_run(
  p_run_id uuid,
  p_quantity integer,
  p_scheduled_at timestamptz
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.organic_run_schedule%ROWTYPE;
  v_owner uuid;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  SELECT * INTO v_run FROM public.organic_run_schedule WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Run not found';
  END IF;

  v_is_admin := public.has_role(v_uid, 'admin'::app_role);

  IF NOT v_is_admin THEN
    SELECT eo.user_id INTO v_owner
    FROM public.engagement_order_items eoi
    JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
    WHERE eoi.id = v_run.engagement_order_item_id;

    IF v_owner IS NULL OR v_owner <> v_uid THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  IF v_run.status IN ('completed','partial','sent') THEN
    RAISE EXCEPTION 'Cannot reschedule a completed run';
  END IF;

  UPDATE public.organic_run_schedule
  SET quantity_to_send = GREATEST(COALESCE(p_quantity, quantity_to_send), 1),
      scheduled_at = COALESCE(p_scheduled_at, scheduled_at),
      status = 'pending',
      error_message = NULL,
      retry_count = 0,
      provider_order_id = NULL,
      provider_response = NULL,
      provider_account_id = NULL,
      user_provider_account_id = NULL,
      rotation_lock_key = NULL,
      updated_at = now()
  WHERE id = p_run_id;

  RETURN json_build_object('success', true, 'run_id', p_run_id, 'extra_charged', 0, 'new_balance', 0);
END;
$$;
