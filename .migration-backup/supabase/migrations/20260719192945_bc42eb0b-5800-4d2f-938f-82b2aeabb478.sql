
-- Restrict platform_settings SELECT to admins (hide markup); maintenance mode still available via is_maintenance_mode() SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Authenticated users can read platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Anyone can read platform settings" ON public.platform_settings;

CREATE POLICY "Only admins can read platform settings"
ON public.platform_settings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Restrict service_provider_mapping SELECT to admins
DROP POLICY IF EXISTS "spm_read_authenticated" ON public.service_provider_mapping;

CREATE POLICY "spm_read_admins"
ON public.service_provider_mapping FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
