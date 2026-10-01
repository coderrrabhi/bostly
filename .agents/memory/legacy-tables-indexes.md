---
name: Restored legacy tables have no primary keys
description: The lovable_legacy schema came from a data-only restore; indexes must be added deliberately and built online.
---
The 29 tables restored from the Supabase backup into schema lovable_legacy arrived without primary keys, foreign keys, or indexes (except auth_* and provider_dispatch_logs). Point lookups by id on organic_run_schedule (166k rows) were 100 ms sequential scans; the worker did hundreds per tick.

**Why:** The backup was data-only; constraints were not restored. Nobody noticed because Supabase had the indexes.

**How to apply:**
- Before assuming a slow legacy endpoint is a code problem, EXPLAIN it; missing indexes are the usual cause.
- New indexes on these tables go in two places: lib/db/scripts/ensure-legacy-indexes.mjs (CREATE INDEX CONCURRENTLY, runs before migrate in production so the live worker is never blocked) and an IF NOT EXISTS migration for fresh environments.
- Drizzle migrations run in a transaction, so CONCURRENTLY cannot be used inside them.
