CREATE INDEX IF NOT EXISTS engagement_orders_live_queue_idx
  ON lovable_legacy.engagement_orders (created_at DESC, id)
  WHERE status IN ('pending', 'processing');