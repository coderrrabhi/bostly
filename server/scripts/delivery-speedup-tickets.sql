-- boostbotting.site only: one automatic Support ticket per delayed provider run.
ALTER TABLE lovable_legacy.organic_run_schedule
  ADD COLUMN IF NOT EXISTS speedup_ticketed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS speedup_ticket_id uuid REFERENCES lovable_legacy.support_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organic_run_schedule_speedup_ticket_idx
  ON lovable_legacy.organic_run_schedule (started_at)
  WHERE speedup_ticketed_at IS NULL AND provider_order_id IS NOT NULL;
