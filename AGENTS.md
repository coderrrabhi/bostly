# Architecture
- Self-hosted backend lives in `server/` (copy of the Express API, own npm package); database structure lives in root `schema.sql` — keep both in sync when tables change.
- Auth: Lovable preview/published frontend uses Lovable Cloud email/password auth; self-hosted VPS uses the Express bcrypt/httpOnly-cookie auth in `server/`. Clerk stays removed. This keeps preview usable while preserving standalone VPS deployment.

- VPS session reads use canonical public compatibility views without provisioning or overwriting account rows; server-side admin checks use the same role view because direct legacy reads are RLS-filtered for the app role.
