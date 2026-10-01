DROP INDEX IF EXISTS public.idx_ors_status_scheduled_at;
DROP INDEX IF EXISTS public.idx_ors_status_last_check;
DROP INDEX IF EXISTS public.idx_ors_engagement_order_item_id;
DROP INDEX IF EXISTS public.idx_ors_user_provider_account_id;
DROP INDEX IF EXISTS public.idx_organic_run_schedule_status_check;

CREATE INDEX IF NOT EXISTS idx_ors_pending_due
  ON public.organic_run_schedule (scheduled_at, last_status_check NULLS FIRST)
  WHERE status = 'pending' AND engagement_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ors_started_provider_check
  ON public.organic_run_schedule (last_status_check NULLS FIRST)
  WHERE status = 'started' AND provider_order_id IS NOT NULL;

ANALYZE public.organic_run_schedule;