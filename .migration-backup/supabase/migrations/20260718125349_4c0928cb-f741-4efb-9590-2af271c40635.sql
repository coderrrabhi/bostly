CREATE OR REPLACE FUNCTION public.compute_rotation_lock_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link text;
  v_type text;
  v_provider_key text;
BEGIN
  -- Lock only while a run is actively held at a provider.
  -- Supports both platform provider accounts and user-added provider accounts.
  IF NEW.status = 'started'
     AND NEW.provider_order_id IS NOT NULL
     AND NEW.engagement_order_item_id IS NOT NULL
     AND (NEW.provider_account_id IS NOT NULL OR NEW.user_provider_account_id IS NOT NULL) THEN

    SELECT lower(btrim(eo.link)), lower(btrim(eoi.engagement_type))
      INTO v_link, v_type
    FROM public.engagement_order_items eoi
    JOIN public.engagement_orders eo ON eo.id = eoi.engagement_order_id
    WHERE eoi.id = NEW.engagement_order_item_id;

    IF NEW.user_provider_account_id IS NOT NULL THEN
      v_provider_key := 'user:' || NEW.user_provider_account_id::text;
    ELSE
      v_provider_key := 'admin:' || NEW.provider_account_id::text;
    END IF;

    IF v_link IS NOT NULL AND v_type IS NOT NULL
       AND v_link <> '' AND v_type <> '' THEN
      NEW.rotation_lock_key := v_link || '||' || v_type || '||' || v_provider_key;
    ELSE
      NEW.rotation_lock_key := NULL;
    END IF;
  ELSE
    NEW.rotation_lock_key := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Keep the active lock index in place. It now also covers user-added providers
-- because the trigger populates rotation_lock_key for user_provider_account_id.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_rotation_lock
ON public.organic_run_schedule(rotation_lock_key)
WHERE rotation_lock_key IS NOT NULL;