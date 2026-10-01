UPDATE public.organic_run_schedule
SET status = 'started',
    completed_at = NULL,
    error_message = 'Re-syncing with provider (delivery in progress)'
WHERE status = 'failed'
  AND provider_order_id IS NOT NULL
  AND provider_status IN ('Pending','In progress','Processing','Inprogress','Awaiting')
  AND error_message ILIKE 'Auto-retry after%';