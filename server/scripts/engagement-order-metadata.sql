BEGIN;
ALTER TABLE lovable_legacy.engagement_orders
  ADD COLUMN IF NOT EXISTS order_name varchar(120),
  ADD COLUMN IF NOT EXISTS curve_name varchar(160);
COMMIT;