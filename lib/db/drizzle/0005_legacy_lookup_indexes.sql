-- The restored Supabase backup arrived without primary keys, so every point
-- lookup by id (worker status updates, order detail pages) and every child-table
-- hydration was a full sequential scan of the largest table (organic_run_schedule,
-- 160k+ rows, ~100 ms per lookup). These indexes make those lookups O(log n).

CREATE INDEX IF NOT EXISTS organic_run_schedule_id_idx
  ON lovable_legacy.organic_run_schedule (id);

CREATE INDEX IF NOT EXISTS organic_run_schedule_item_run_idx
  ON lovable_legacy.organic_run_schedule (engagement_order_item_id, run_number);

CREATE INDEX IF NOT EXISTS engagement_order_items_id_idx
  ON lovable_legacy.engagement_order_items (id);

CREATE INDEX IF NOT EXISTS engagement_orders_id_idx
  ON lovable_legacy.engagement_orders (id);

CREATE INDEX IF NOT EXISTS engagement_orders_order_number_idx
  ON lovable_legacy.engagement_orders (order_number);
