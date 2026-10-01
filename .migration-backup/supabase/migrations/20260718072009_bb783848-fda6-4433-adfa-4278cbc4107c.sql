
-- Fix 1: Restrict platform_settings SELECT policy to authenticated role
DROP POLICY IF EXISTS "Admins read platform settings" ON public.platform_settings;
CREATE POLICY "Admins read platform settings"
ON public.platform_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix 2: Add explicit deny-all write policies for rotation_alert_state (service_role bypasses RLS)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rotation_alert_state') THEN
    EXECUTE 'ALTER TABLE public.rotation_alert_state ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Block user inserts on rotation_alert_state" ON public.rotation_alert_state;
    DROP POLICY IF EXISTS "Block user updates on rotation_alert_state" ON public.rotation_alert_state;
    DROP POLICY IF EXISTS "Block user deletes on rotation_alert_state" ON public.rotation_alert_state;

    CREATE POLICY "Block user inserts on rotation_alert_state"
      ON public.rotation_alert_state FOR INSERT TO authenticated
      WITH CHECK (false);
    CREATE POLICY "Block user updates on rotation_alert_state"
      ON public.rotation_alert_state FOR UPDATE TO authenticated
      USING (false) WITH CHECK (false);
    CREATE POLICY "Block user deletes on rotation_alert_state"
      ON public.rotation_alert_state FOR DELETE TO authenticated
      USING (false);
  END IF;
END $$;
