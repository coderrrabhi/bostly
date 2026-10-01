UPDATE organic_run_schedule ors SET
  status='cancelled',
  completed_at=NOW(),
  error_message='Stale backlog cleanup (>24h) — was blocking fresh orders',
  rotation_lock_key=NULL
FROM engagement_order_items eoi, engagement_orders eo
WHERE ors.engagement_order_item_id=eoi.id
  AND eoi.engagement_order_id=eo.id
  AND ors.status='pending'
  AND eo.created_at < NOW() - INTERVAL '24 hours';

UPDATE organic_run_schedule SET
  status='failed', completed_at=NOW(), retry_count=99,
  error_message='Ghost cleanup (>30min started, no provider order id)',
  rotation_lock_key=NULL
WHERE status='started' AND provider_order_id IS NULL
  AND started_at < NOW() - INTERVAL '30 minutes';