ALTER TABLE public.organic_run_schedule
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

UPDATE public.organic_run_schedule
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_organic_run_schedule_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organic_run_schedule_updated_at ON public.organic_run_schedule;
CREATE TRIGGER trg_organic_run_schedule_updated_at
BEFORE UPDATE ON public.organic_run_schedule
FOR EACH ROW
EXECUTE FUNCTION public.set_organic_run_schedule_updated_at();

CREATE OR REPLACE FUNCTION public.reschedule_organic_run(
  p_run_id uuid,
  p_quantity integer,
  p_scheduled_at timestamp with time zone
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run public.organic_run_schedule%ROWTYPE;
  v_owner uuid;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_new_quantity integer;
  v_new_scheduled_at timestamp with time zone;
BEGIN
  SELECT * INTO v_run
  FROM public.organic_run_schedule
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Run not found';
  END IF;

  v_is_admin := public.has_role(v_uid, 'admin'::app_role);

  IF NOT v_is_admin THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT COALESCE(eo.user_id, o.user_id) INTO v_owner
    FROM public.organic_run_schedule rs
    LEFT JOIN public.engagement_order_items eoi ON eoi.id = rs.engagement_order_item_id
    LEFT JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
    LEFT JOIN public.orders o ON o.id = rs.order_id
    WHERE rs.id = p_run_id;

    IF v_owner IS NULL OR v_owner <> v_uid THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  IF v_run.status IN ('completed', 'partial', 'sent', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot reschedule a completed or cancelled run';
  END IF;

  v_new_quantity := GREATEST(COALESCE(p_quantity, v_run.quantity_to_send), 1);
  v_new_scheduled_at := COALESCE(p_scheduled_at, v_run.scheduled_at);

  UPDATE public.organic_run_schedule
  SET quantity_to_send = v_new_quantity,
      base_quantity = v_new_quantity,
      variance_applied = 0,
      scheduled_at = v_new_scheduled_at,
      status = 'pending',
      error_message = NULL,
      retry_count = 0,
      provider_order_id = NULL,
      provider_response = NULL,
      provider_status = NULL,
      provider_start_count = NULL,
      provider_remains = NULL,
      provider_charge = NULL,
      last_status_check = NULL,
      started_at = NULL,
      completed_at = NULL,
      provider_account_id = NULL,
      provider_account_name = NULL,
      user_provider_account_id = NULL,
      user_provider_account_name = NULL,
      rotation_lock_key = NULL,
      updated_at = now()
  WHERE id = p_run_id;

  RETURN json_build_object(
    'success', true,
    'run_id', p_run_id,
    'quantity_to_send', v_new_quantity,
    'scheduled_at', v_new_scheduled_at,
    'extra_charged', 0,
    'new_balance', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_organic_run(
  p_run_id uuid,
  p_delay_minutes integer DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run public.organic_run_schedule%ROWTYPE;
  v_owner uuid;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_delay integer;
  v_new_scheduled_at timestamp with time zone;
BEGIN
  SELECT * INTO v_run
  FROM public.organic_run_schedule
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Run not found';
  END IF;

  v_is_admin := public.has_role(v_uid, 'admin'::app_role);

  IF NOT v_is_admin THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT COALESCE(eo.user_id, o.user_id) INTO v_owner
    FROM public.organic_run_schedule rs
    LEFT JOIN public.engagement_order_items eoi ON eoi.id = rs.engagement_order_item_id
    LEFT JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
    LEFT JOIN public.orders o ON o.id = rs.order_id
    WHERE rs.id = p_run_id;

    IF v_owner IS NULL OR v_owner <> v_uid THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  IF v_run.status IN ('completed', 'partial', 'sent', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot reschedule a completed or cancelled run';
  END IF;

  v_delay := GREATEST(COALESCE(p_delay_minutes, 30), 1);
  v_new_scheduled_at := now() + make_interval(mins => v_delay);

  UPDATE public.organic_run_schedule
  SET status = 'pending',
      scheduled_at = v_new_scheduled_at,
      error_message = NULL,
      retry_count = COALESCE(retry_count, 0) + 1,
      provider_order_id = NULL,
      provider_response = NULL,
      provider_status = NULL,
      provider_start_count = NULL,
      provider_remains = NULL,
      provider_charge = NULL,
      last_status_check = NULL,
      started_at = NULL,
      completed_at = NULL,
      provider_account_id = NULL,
      provider_account_name = NULL,
      user_provider_account_id = NULL,
      user_provider_account_name = NULL,
      rotation_lock_key = NULL,
      updated_at = now()
  WHERE id = p_run_id;

  RETURN json_build_object(
    'success', true,
    'run_id', p_run_id,
    'scheduled_at', v_new_scheduled_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_organic_run(uuid, integer, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reschedule_organic_run(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_organic_run(uuid, integer, timestamp with time zone) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_organic_run(uuid, integer) TO authenticated, service_role;