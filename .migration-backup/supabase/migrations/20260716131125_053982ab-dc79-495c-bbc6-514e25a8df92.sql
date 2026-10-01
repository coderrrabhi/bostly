ALTER TABLE public.organic_run_schedule
  ADD COLUMN IF NOT EXISTS user_provider_account_id uuid REFERENCES public.user_provider_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_provider_account_name text;

ALTER TABLE public.engagement_order_items
  ADD COLUMN IF NOT EXISTS user_bundle_item_id uuid REFERENCES public.user_bundle_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_mappings jsonb;

CREATE INDEX IF NOT EXISTS idx_organic_run_schedule_user_provider_account_id
  ON public.organic_run_schedule(user_provider_account_id)
  WHERE user_provider_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_order_items_user_bundle_item_id
  ON public.engagement_order_items(user_bundle_item_id)
  WHERE user_bundle_item_id IS NOT NULL;