# Architecture
- Self-hosted backend lives in `server/` (copy of the Express API, own npm package); database structure lives in root `schema.sql` — keep both in sync when tables change.
- Auth: Lovable preview/published frontend uses Lovable Cloud email/password auth; self-hosted VPS uses the Express bcrypt/httpOnly-cookie auth in `server/`. Clerk stays removed. This keeps preview usable while preserving standalone VPS deployment.

- VPS session reads use canonical public compatibility views without provisioning or overwriting account rows; server-side admin checks use the same role view because direct legacy reads are RLS-filtered for the app role.

- Mount ContactHelp once in the global app shell outside page routing, so subscription/support contacts remain available on public and authenticated pages.

- Keep safe-demo static and browser-only under artifacts/boostly-pro/public/safe-demo with connect-src none and form-action none; never import provider, wallet, auth, or order submission APIs into its source.
