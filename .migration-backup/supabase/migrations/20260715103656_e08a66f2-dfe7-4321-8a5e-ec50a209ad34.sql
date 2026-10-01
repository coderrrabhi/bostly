CREATE UNIQUE INDEX IF NOT EXISTS user_bundle_item_providers_unique_enabled_priority
ON public.user_bundle_item_providers (user_bundle_item_id, priority)
WHERE enabled = true;