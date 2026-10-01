ALTER TABLE lovable_legacy.user_provider_accounts
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 1;

ALTER TABLE lovable_legacy.organic_run_schedule
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_uncertain boolean NOT NULL DEFAULT false;

WITH active_runs AS (
  SELECT rs.id,
         row_number() OVER (
           PARTITION BY eo.user_id,rs.user_provider_account_id,lower(eoi.engagement_type),
             lower(regexp_replace(trim(eo.link), '/+$', ''))
           ORDER BY rs.started_at,rs.created_at,rs.id
         ) AS lock_rank,
         concat(
           eo.user_id,':',rs.user_provider_account_id,':',lower(eoi.engagement_type),':',
           encode(digest(lower(regexp_replace(trim(eo.link), '/+$', '')), 'sha256'),'hex')
         ) AS lock_key
    FROM lovable_legacy.organic_run_schedule rs
    JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
    JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
   WHERE rs.user_provider_account_id IS NOT NULL
     AND rs.provider_order_id IS NOT NULL
     AND rs.status IN ('started','processing','dispatch_uncertain')
)
UPDATE lovable_legacy.organic_run_schedule rs
   SET rotation_lock_key=active_runs.lock_key
  FROM active_runs
 WHERE rs.id=active_runs.id
   AND active_runs.lock_rank=1
   AND rs.rotation_lock_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organic_run_active_rotation_lock_uidx
  ON lovable_legacy.organic_run_schedule (rotation_lock_key)
  WHERE rotation_lock_key IS NOT NULL
    AND status IN ('dispatching', 'started', 'processing', 'dispatch_uncertain');

CREATE INDEX IF NOT EXISTS organic_run_executor_queue_idx
  ON lovable_legacy.organic_run_schedule (scheduled_at, run_number)
  WHERE status = 'pending' AND provider_order_id IS NULL;

CREATE INDEX IF NOT EXISTS organic_run_status_checker_idx
  ON lovable_legacy.organic_run_schedule (last_status_check, updated_at)
  WHERE status IN ('started', 'processing') AND provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lovable_legacy.provider_dispatch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  engagement_order_id uuid,
  user_id uuid,
  provider_account_id uuid,
  provider_account_name text,
  event text NOT NULL,
  provider_order_id text,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_dispatch_logs_run_idx
  ON lovable_legacy.provider_dispatch_logs (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_dispatch_logs_account_idx
  ON lovable_legacy.provider_dispatch_logs (provider_account_id, created_at DESC);