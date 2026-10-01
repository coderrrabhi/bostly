#!/usr/bin/env bash
# =============================================================
# Import schema + data + users into the self-hosted DB on VPS
# Run AFTER selfhost-backend.sh, from the repo root on the VPS:
#   bash vps/import-data.sh /root/backup
# =============================================================
set -euo pipefail

BACKUP_DIR="${1:-/root/backup}"
STACK_DIR="/opt/supabase"
DB="postgresql://postgres:$(grep '^POSTGRES_PASSWORD=' /root/.boostly-secrets | cut -d= -f2)@127.0.0.1:5432/postgres"

echo "==> checking backup files in $BACKUP_DIR"
ls -la "$BACKUP_DIR"
echo
echo "Expected (from Lovable Cloud -> Advanced settings -> Export data):"
echo "  roles.sql | schema.sql | data.sql     (or a single db_cluster dump)"
echo

apply() {
  local f="$1"
  [ -f "$f" ] || { echo "   skip (missing): $f"; return; }
  echo "==> applying $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=0 -f "$f"
}

apply "$BACKUP_DIR/roles.sql"
apply "$BACKUP_DIR/schema.sql"
apply "$BACKUP_DIR/data.sql"

# single-file cluster dump fallback
if [ -f "$BACKUP_DIR/db_cluster.sql" ]; then
  echo "==> applying db_cluster.sql"
  psql "$DB" -v ON_ERROR_STOP=0 -f "$BACKUP_DIR/db_cluster.sql"
fi

echo "==> 1) applying repo migrations (idempotent top-up)"
if [ -d supabase/migrations ]; then
  for f in supabase/migrations/*.sql; do
    echo "   -> $f"
    psql "$DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
  done
fi

echo "==> 2) verifying users + core tables"
psql "$DB" -c "select count(*) as auth_users from auth.users;"
psql "$DB" -c "select count(*) as profiles from public.profiles;" || true
psql "$DB" -c "select count(*) as providers from public.user_provider_accounts;" || true
psql "$DB" -c "select count(*) as bundles from public.user_bundles;" || true
psql "$DB" -c "select count(*) as orders from public.engagement_orders;" || true

echo "==> 3) enabling pg_cron + scheduling schedulers"
psql "$DB" <<'SQL'
create extension if not exists pg_cron;
create extension if not exists pg_net;
SQL

echo "==> 4) deploying edge functions"
if ! command -v supabase >/dev/null 2>&1; then
  npm i -g supabase >/dev/null 2>&1 || true
fi
echo "   For self-hosted edge runtime, copy functions into the stack volume:"
mkdir -p "$STACK_DIR/volumes/functions"
cp -r supabase/functions/. "$STACK_DIR/volumes/functions/" 2>/dev/null || true
( cd "$STACK_DIR" && docker compose restart functions ) || true

echo
echo "================ IMPORT DONE ================"
echo "Users ke passwords same rahenge (encrypted hashes copy hote hain)."
echo "Ab frontend ka .env already api domain pe point kar raha hai — rebuild:"
echo "  bun run build && systemctl reload nginx"
