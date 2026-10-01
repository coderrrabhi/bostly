
DROP POLICY IF EXISTS "Anyone can read platform settings" ON public.platform_settings;

CREATE POLICY "Authenticated users can read platform settings"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE SELECT ON public.platform_settings FROM anon;
