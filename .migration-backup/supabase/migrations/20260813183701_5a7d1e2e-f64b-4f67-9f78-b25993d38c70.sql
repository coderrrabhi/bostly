-- Hot path 1+2: "busy provider" checks (274k + 190k calls)
CREATE INDEX IF NOT EXISTS idx_ors_upa_started ON public.organic_run_schedule (user_provider_account_id, started_at DESC) WHERE user_provider_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ors_pa_started ON public.organic_run_schedule (provider_account_id, started_at DESC) WHERE provider_account_id IS NOT NULL;

-- Hot path: status worker pickup (started runs, oldest check first)
CREATE INDEX IF NOT EXISTS idx_ors_started_lastcheck ON public.organic_run_schedule (last_status_check NULLS FIRST, scheduled_at) WHERE status = 'started';

-- Hot path: item run rollups + item history (543k calls)
CREATE INDEX IF NOT EXISTS idx_ors_item_status ON public.organic_run_schedule (engagement_order_item_id, status);

-- Hot path: failed-run retry sweep
CREATE INDEX IF NOT EXISTS idx_ors_failed_completed ON public.organic_run_schedule (completed_at) WHERE status = 'failed';

-- Hot path: user order history page (845 calls, 555ms avg)
CREATE INDEX IF NOT EXISTS idx_eo_user_created ON public.engagement_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eoi_order ON public.engagement_order_items (engagement_order_id);

ANALYZE public.organic_run_schedule;
ANALYZE public.engagement_order_items;
ANALYZE public.engagement_orders;