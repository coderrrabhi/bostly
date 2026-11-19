-- boostbotting.site only: Peak Hours is an explicit customer opt-in.
-- This changes saved preferences only; it never reschedules or resends paid runs.
BEGIN;
UPDATE lovable_legacy.engagement_orders
   SET peak_hours_enabled = false
 WHERE peak_hours_enabled IS DISTINCT FROM false;
ALTER TABLE lovable_legacy.engagement_orders
  ALTER COLUMN peak_hours_enabled SET DEFAULT false,
  ALTER COLUMN peak_hours_enabled SET NOT NULL;
COMMIT;
