
DROP POLICY IF EXISTS "popup_ads public read" ON public.popup_ads;
CREATE POLICY "popup_ads authenticated read enabled"
ON public.popup_ads
FOR SELECT
TO authenticated
USING (enabled = true);

DROP POLICY IF EXISTS "Anyone can view active services" ON public.services;
CREATE POLICY "Authenticated can view active services"
ON public.services
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active bundles" ON public.engagement_bundles;
CREATE POLICY "Authenticated can view active bundles"
ON public.engagement_bundles
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view bundle items" ON public.bundle_items;
CREATE POLICY "Authenticated can view bundle items"
ON public.bundle_items
FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON public.popup_ads FROM anon;
REVOKE SELECT ON public.services FROM anon;
REVOKE SELECT ON public.engagement_bundles FROM anon;
REVOKE SELECT ON public.bundle_items FROM anon;
