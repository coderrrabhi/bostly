# Moving Boostly Pro to Replit's Asia geography

Why: the live site is published in North America while its users are in India, so
every request pays ~280 ms of pure network latency (measured 2026-09-07). Replit
publishes compute, database and storage together in one geography, and that
choice is permanent per project — so the move is done by remixing this project
and publishing the copy in Asia.

Docs: https://docs.replit.com/features/publishing/project-geography and
https://docs.replit.com/features/projects-and-artifacts/remix-an-app

## What carries over automatically in a Remix (of your own app)

- All files, config and checkpoint history; secret names and values.
- A fresh development database (optional "Copy data from original App").

## What does NOT carry over (must be redone)

- The deployment, the custom domain (`boostbotting.site`) and the production database.
- The Clerk tenant. The remix gets a fresh Replit-managed Clerk instance with zero users.
  This is fine: `POST /api/auth/legacy-login` verifies the old email + password against
  `lovable_legacy.auth_credentials` and re-creates/links the Clerk account on the fly,
  so all migrated users keep their existing credentials. Anyone who changed their
  password through Clerk after the migration must use "Forgot password" once.
- Object Storage is not used by the app, so nothing to copy there.

## Runbook

1. **Publish the current project first** so users get the latest speed work while the
   move is prepared (optional but recommended).
2. **Remix**: open this project's cover page → *Remix this App* → name it
   (e.g. "Boostly Pro Asia"). Tick *Copy data from original App* (dev data only).
3. **In the remix**: confirm the workflows start, run `pnpm --filter @workspace/db migrate`,
   log in with a legacy account in dev to confirm auth works with the new Clerk tenant.
4. **Publish the remix**: Publishing → *Advanced* → *Geography* = **Asia** → Reserved VM
   (same size as today) → Publish. Test on the new `*.replit.app` URL: legacy login,
   dashboard, engagement orders, admin panel. Measure `/api/healthz` from India.
5. **Cutover (15–30 minute window, do it at a quiet hour)**
   1. Old site: Admin → *Maintenance Mode* ON, then stop the old deployment so its
      worker cannot dispatch orders while data is being copied.
   2. Copy production data. Get both production connection strings from each project's
      Database tool → *Settings* (production), then from a Shell:
      ```
      pg_dump -Fc "<OLD_PRODUCTION_DATABASE_URL>" --no-owner --no-privileges -f boostly-prod.dump
      pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
        -d "<NEW_PRODUCTION_DATABASE_URL>" boostly-prod.dump
      ```
      Then start the new deployment (its run command builds the legacy indexes and runs
      migrations automatically) and spot-check a few orders/wallets in the admin panel.
   3. Domain: old project → Publishing → *Domains* → disconnect `boostbotting.site`;
      new project → *Domains* → add it and set the DNS records Replit shows.
      Propagation takes minutes to a few hours; the `*.replit.app` URL works meanwhile.
6. **Clean up**: delete the old deployment (otherwise two Reserved VMs are billed). Keep
   the old project itself for a couple of weeks as a fallback.

## Expected result

Per-request latency from India drops from ~280 ms to roughly a quarter of that (exact
figure depends on where in Asia Replit hosts the region — measure `/api/healthz`
after publishing). Everything else (code, features, pricing, providers) is unchanged;
users are logged out once and sign in again.
