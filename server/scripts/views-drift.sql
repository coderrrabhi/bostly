ALTER TABLE lovable_legacy.organic_run_schedule ADD COLUMN IF NOT EXISTS drift_adjustment integer NOT NULL DEFAULT 0;
