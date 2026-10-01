DROP POLICY IF EXISTS "Everyone can view bundle items" ON public.bundle_items;
CREATE POLICY "View bundle items of active bundles"
ON public.bundle_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.engagement_bundles eb
    WHERE eb.id = bundle_items.bundle_id AND eb.is_active = true
  )
  OR public.has_role(auth.uid(), 'admin'::app_role)
);