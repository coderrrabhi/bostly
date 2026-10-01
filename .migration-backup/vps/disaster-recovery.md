# Boostly Pro — Disaster Recovery Playbook

If the VPS dies or you need to move to a new host, this checklist restores everything.

## What you MUST have saved before disaster

1. **GitHub repository** — `https://github.com/lvesachin-crypto/soss-organic-hub`
   - Contains frontend code, edge functions, deployment scripts, migrations.
2. **Database backup** — `/root/backups/latest/db_cluster.sql.gz`
   - Full Postgres cluster: users, orders, providers, bundles, auth password hashes.
3. **Secrets file** — `/root/.boostly-secrets`
   - `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_PASSWORD`.
4. **Provider master key** — `PROVIDER_KEY_SECRET`
   - Needed to decrypt every user's stored API keys.
5. **Payment / AI keys** — set in `/opt/supabase/functions.env`:
   - `ZAPUPI_KEY`, `OXAPAY_API_KEY`, `CRON_SECRET`, `LOVABLE_API_KEY`, etc.
6. **Domain DNS control** — `boostbotting.site` registrar access.

## New VPS setup (after disaster)

### Step 1 — Buy new VPS, point DNS
Point A records to the new IP:
- `boostbotting.site`
- `www`
- `api`

### Step 2 — Clone repo and run backend installer
```bash
ssh root@<NEW_IP>
git clone https://github.com/lvesachin-crypto/soss-organic-hub.git /var/www/boostly
cd /var/www/boostly
nano vps/selfhost-backend.sh
# edit DOMAIN, API_DOMAIN, EMAIL, GIT_REPO
bash vps/selfhost-backend.sh
```
This installs Docker, Supabase stack, Nginx, SSL, and builds the frontend.

### Step 3 — Restore secrets
Copy your saved `/root/.boostly-secrets` to the new server and run:
```bash
cd /var/www/boostly
bash vps/set-function-secrets.sh PROVIDER_KEY_SECRET=YOUR_KEY CRON_SECRET=YOUR_SECRET ZAPUPI_KEY=YOUR_KEY OXAPAY_API_KEY=YOUR_KEY
```

### Step 4 — Restore database
Upload the latest backup to the new server, then:
```bash
# extract
gunzip -c /root/backups/latest/db_cluster.sql.gz > /root/latest.sql

# restore into the new local postgres
DB="postgresql://postgres:$(grep '^POSTGRES_PASSWORD=' /root/.boostly-secrets | cut -d= -f2)@127.0.0.1:5432/postgres"
psql "$DB" -f /root/latest.sql
```

### Step 5 — Start workers
```bash
cd /var/www/boostly
bash vps/setup-local-workers.sh
```

### Step 6 — Verify
```bash
docker ps --format '{{.Names}}  {{.Status}}'
```
Open `https://boostbotting.site` and test login.

## Rollback to Lovable Cloud (temporary)

If you only want to stop using the VPS and go back to Lovable Cloud for a while:
1. In `src/integrations/supabase/client.ts` or `frontend .env`, point back to:
   - `VITE_SUPABASE_URL=https://<lovable-project>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=<lovable-anon-key>`
2. Rebuild and redeploy.
3. Note: Lovable Cloud database may be behind if you did not keep syncing. Use the `db-setup` edge function to sync from VPS back to Lovable if needed.

## Backup automation

Schedule daily backups:
```bash
mkdir -p /root/backups
(crontab -l 2>/dev/null; echo "0 2 * * * cd /var/www/boostly && bash vps/backup.sh >> /var/log/boostly-backup.log 2>&1") | crontab -
```

Run manually anytime:
```bash
cd /var/www/boostly && bash vps/backup.sh
```
