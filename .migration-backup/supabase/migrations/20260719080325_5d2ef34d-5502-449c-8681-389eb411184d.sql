-- Add missing foreign key so PostgREST can embed provider_accounts
ALTER TABLE public.organic_run_schedule
  ADD CONSTRAINT organic_run_schedule_provider_account_id_fkey
  FOREIGN KEY (provider_account_id) REFERENCES public.provider_accounts(id) ON DELETE SET NULL;

-- Helpful indexes for scheduler hot path (idempotent)
CREATE INDEX IF NOT EXISTS idx_ors_status_scheduled_at ON public.organic_run_schedule (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ors_status_last_check ON public.organic_run_schedule (status, last_status_check);
CREATE INDEX IF NOT EXISTS idx_ors_engagement_order_item_id ON public.organic_run_schedule (engagement_order_item_id);
CREATE INDEX IF NOT EXISTS idx_ors_provider_order_id ON public.organic_run_schedule (provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ors_user_provider_account_id ON public.organic_run_schedule (user_provider_account_id);
CREATE INDEX IF NOT EXISTS idx_ors_provider_account_id ON public.organic_run_schedule (provider_account_id);