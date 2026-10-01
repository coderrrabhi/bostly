-- Remove duplicate engagement types per bundle, keep oldest
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_bundle_id, engagement_type ORDER BY created_at, id) AS rn
  FROM public.user_bundle_items
)
DELETE FROM public.user_bundle_items WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Prevent duplicates going forward
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_bundle_items_bundle_type
  ON public.user_bundle_items (user_bundle_id, engagement_type);