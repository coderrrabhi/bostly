# Boostly Pro

Organic social-media marketing platform (SMM panel): users connect their own SMM provider accounts, build bundles, and place Full Engagement / Mass orders that are delivered on randomized organic schedules. Ported from a Lovable/Supabase project; auth is Clerk, data is PostgreSQL.

## Run & Operate

- Workflows: `artifacts/boostly-pro: web` (Vite SPA, port 21544, preview `/`) and `artifacts/api-server: API Server` (Express, port 8080, preview `/api`).
- `pnpm run typecheck` — full typecheck; `pnpm --filter @workspace/boostly-pro run build` — production bundle + pre-compressed `.br/.gz` files in `artifacts/boostly-pro/dist/public`.
- `pnpm --filter @workspace/db migrate` — apply SQL migrations in `lib/db/drizzle/` (dev must run this by hand; production runs it on every start).
- Production start order (api-server `artifact.toml`): `node lib/db/scripts/ensure-legacy-indexes.mjs` (CREATE INDEX CONCURRENTLY, never blocks writers) → `migrate` → API. Add new legacy-table indexes to that script *and* an `IF NOT EXISTS` migration.
- Production web service: `node artifacts/boostly-pro/server/serve.mjs` (sirv) instead of the platform static handler — brotli/gzip, immutable `/assets/*`, `no-cache` HTML shell, SPA fallback.
- Required env: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, object-storage vars. Optional: `WORKER_POOL_MAX` (background worker DB pool, default 6).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9; React 18 + Vite + React Router 7 + TanStack Query; Express 5; PostgreSQL + Drizzle ORM (`pg` pool for legacy SQL); Clerk (`@clerk/react`, `@clerk/express`); Zod.

## Where things live

- `artifacts/boostly-pro/src` — app shell, `App.tsx` (routes, Clerk provider), `hooks/useAuth.tsx`, `lib/api.ts`, `components/layout/Sidebar.tsx`. Many pages re-export the ported originals from `.migration-backup/src` (Lovable code, kept behaviour-compatible).
- `artifacts/boostly-pro/src/integrations/supabase/client.ts` — Supabase-compatible query builder that posts to `POST /api/legacy/query`.
- `artifacts/api-server/src/routes/legacyData.ts` — legacy table read API (owner scoping, nested column projection, slow-query log); `legacy*.ts` — mutations/RPC/providers; `lib/identity.ts` — Clerk id → legacy UUID cache; `workers/multiProviderRotationWorker.ts` — order dispatch.
- `lib/db/src/schema` — Drizzle schema for new tables; the 29 restored Supabase tables live in schema `lovable_legacy` (no PKs/FKs; see indexes migration 0005).

## Architecture decisions

- Legacy data stays in `lovable_legacy`; Clerk users carry the old Supabase UUID as `externalId`; legacy password logins are verified with `crypt()` then converted to Clerk sessions.
- Providers are tenant-scoped; bundle provider mappings attach to stable provider account ids (API keys rotate, mappings must survive inactivity).
- Clerk script versions are pinned in `App.tsx` (`__internal_clerkJSVersion` / `__internal_clerkUIVersion`) to skip two redirect round trips per page load; bump both deliberately after testing.
- Identity cache (`lib/identity.ts`) caches only the Clerk→legacy id (immutable); the admin role is always read fresh from `user_roles`.
- The frontend session snapshot (`useAuth`) is sessionStorage, keyed by user id, display fields only (no api_key, no balances).

## Product

- Dashboard, Full Engagement order, Mass Order, Engagement Orders tracking, single Orders, Wallet, My Providers, My Services, My Bundles, Subscription (Monthly $39 / Yearly $199 / Lifetime $399), Support, API access, Admin Control Center.

## User preferences

- Reply in English only. Owner pays for a Reserved VM and cares most about real perceived speed of the live site; verify with measurements, do not claim speed without them.

## Gotchas

- The live deployment is in North America and the users are in India: ~280 ms per round trip is the floor. Reduce request counts; moving the project to the Asia geography requires a remix + republish.
- `/api/legacy/query` hydrates nested relations itself; a `select` with explicit nested columns is honoured (SELECT * otherwise), so keep page selects narrow — `organic_run_schedule` has 166k rows.
- `PopupAdDialog` polls; keep its interval long (120 s).
- Do not edit `artifact.toml` directly; use the artifacts skill flow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
