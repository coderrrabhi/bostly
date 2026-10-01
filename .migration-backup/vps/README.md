# Boostly Pro — Full Self-Host on VPS (Frontend + Backend + Database)

VPS: `91.188.254.184` (Space Hosting). Minimum **4 GB RAM**, recommended **8 GB** for 100k daily orders.

## Step 0 — DNS
Point these A records to `91.188.254.184`:

| Record | Value |
|---|---|
| `boostbotting.site` | 91.188.254.184 |
| `www` | 91.188.254.184 |
| `api` | 91.188.254.184 |

## Step 1 — Data export (Lovable side)
Backend → **Advanced settings → Export data**. Download the dump files (`roles.sql`, `schema.sql`, `data.sql`, or a single cluster dump) — these include `auth.users` with encrypted password hashes, so users keep their existing passwords.

Upload them to the VPS:
```bash
scp -r ./backup root@91.188.254.184:/root/backup
```

## Step 2 — Backend + Database
```bash
ssh root@91.188.254.184
git clone https://github.com/lvesachin-crypto/bosstlypro.git /var/www/boostly
cd /var/www/boostly
nano vps/selfhost-backend.sh     # set DOMAIN, API_DOMAIN, EMAIL, GIT_REPO
bash vps/selfhost-backend.sh
```
This installs Docker, the Supabase self-host stack (Postgres, Auth, REST, Realtime, Storage, Edge Runtime, Studio), generates JWT/anon/service keys, builds the frontend, configures Nginx + SSL, and opens the firewall.

Generated secrets land in `/root/.boostly-secrets` (keep it private).

## Step 3 — Import schema, data and users
```bash
cd /var/www/boostly
bash vps/import-data.sh /root/backup
```
Then it verifies row counts, enables `pg_cron`/`pg_net`, and copies edge functions into the stack.

## Step 4 — Cron jobs (schedulers)
Inside Studio → SQL editor (or `psql`), schedule the two workers:
```sql
select cron.schedule('execute-all-runs-3m', '*/3 * * * *', $$
  select net.http_post(
    url := 'https://api.boostbotting.site/functions/v1/execute-all-runs',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);

select cron.schedule('check-order-status-5m', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://api.boostbotting.site/functions/v1/check-order-status',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);

select cron.schedule('cleanup-finished-1h', '0 * * * *',
  $$ select public.cleanup_old_completed_engagement_orders(); $$);
```

## Step 5 — Function secrets
Set these in `/opt/supabase/.env` (then `docker compose up -d`):
`PROVIDER_KEY_SECRET`, `CRON_SECRET`, `LOVABLE_API_KEY` (AI features), plus payment keys.

## Rebuild after code changes
```bash
cd /var/www/boostly && git pull && bun install && bun run build && systemctl reload nginx
```

## Backups (daily 2 AM)

Run a backup manually:
```bash
cd /var/www/boostly && bash vps/backup.sh
```

Schedule automatic daily backups:
```bash
mkdir -p /root/backups
(crontab -l 2>/dev/null; echo "0 2 * * * cd /var/www/boostly && bash vps/backup.sh >> /var/log/boostly-backup.log 2>&1") | crontab -
```

This saves:
- Full Postgres cluster dump
- `/root/.boostly-secrets`
- `/opt/supabase/.env`
- Edge function manifest

Backups are kept for 7 days in `/root/backups`. Latest backup is always symlinked to `/root/backups/latest`.

**Disaster recovery guide:** see `vps/disaster-recovery.md`

## Rollback
Frontend `.env` ko wapas Lovable Cloud URL + publishable key pe set karke rebuild kar do — backend Lovable pe intact rehta hai.
