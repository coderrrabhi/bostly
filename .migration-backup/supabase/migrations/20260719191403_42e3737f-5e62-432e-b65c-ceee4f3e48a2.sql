
CREATE INDEX IF NOT EXISTS idx_ors_status_scheduled_lastcheck
  ON public.organic_run_schedule (status, scheduled_at, last_status_check NULLS FIRST)
  WHERE engagement_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ors_status_retry_completed
  ON public.organic_run_schedule (status, retry_count, completed_at)
  WHERE engagement_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ors_eoi_status
  ON public.organic_run_schedule (engagement_order_item_id, status);

ANALYZE public.organic_run_schedule;
