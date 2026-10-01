CREATE INDEX IF NOT EXISTS idx_upa_user_active ON public.user_provider_accounts (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ubip_item_priority ON public.user_bundle_item_providers (user_bundle_item_id, priority) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_user_services_acct_service ON public.user_services (user_provider_account_id, provider_service_id);
CREATE INDEX IF NOT EXISTS idx_ors_lock_active ON public.organic_run_schedule (rotation_lock_key) WHERE status IN ('pending','started');