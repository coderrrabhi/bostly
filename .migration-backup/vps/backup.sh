#!/usr/bin/env bash
# =============================================================
# Boostly Pro — Daily automated backup for VPS self-host stack
# Backs up: full Postgres cluster, secrets, Supabase .env, edge functions
# Run manually:  bash vps/backup.sh
# Schedule via cron:  0 2 * * * cd /var/www/boostly && bash vps/backup.sh
# =============================================================
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/root/backups}"
DATE_TAG="$(date +%F-%H%M%S)"
TODAY_DIR="$BACKUP_ROOT/$DATE_TAG"
LATEST_LINK="$BACKUP_ROOT/latest"
KEEP_DAYS="${KEEP_DAYS:-7}"

STACK_DIR="${STACK_DIR:-/opt/supabase}"
APP_DIR="${APP_DIR:-/var/www/boostly}"
SECRETS_FILE="/root/.boostly-secrets"

mkdir -p "$TODAY_DIR"

echo "==> backup directory: $TODAY_DIR"

# ---------- 1. Database (full cluster dump) ----------
echo "==> 1/4 dumping PostgreSQL cluster"
DB_CONTAINER="$(cd "$STACK_DIR" && docker compose ps -q db 2>/dev/null || true)"
if [ -z "$DB_CONTAINER" ]; then
  echo "ERROR: db container not found. Is the stack running?" >&2
  exit 1
fi

# Wait until postgres is ready
docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || {
  echo "ERROR: postgres is not ready" >&2
  exit 1
}

DUMP_FILE="$TODAY_DIR/db_cluster.sql.gz"
docker exec "$DB_CONTAINER" pg_dumpall -U postgres | gzip > "$DUMP_FILE"
DUMPSIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "   -> $DUMP_FILE ($DUMPSIZE)"

# ---------- 2. Secrets & environment ----------
echo "==> 2/4 backing up secrets & env"
[ -f "$SECRETS_FILE" ] && cp "$SECRETS_FILE" "$TODAY_DIR/boostly-secrets.txt"
[ -f "$STACK_DIR/.env" ] && cp "$STACK_DIR/.env" "$TODAY_DIR/supabase-env.txt"
[ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" "$TODAY_DIR/frontend-env.txt"

# ---------- 3. Edge functions list (code lives in GitHub, but manifest helps) ----------
echo "==> 3/4 saving edge function manifest"
ls "$APP_DIR/supabase/functions" > "$TODAY_DIR/edge-functions-manifest.txt" 2>/dev/null || true

# ---------- 4. Rotation & latest symlink ----------
echo "==> 4/4 rotating old backups (keep $KEEP_DAYS days)"
rm -f "$LATEST_LINK"
ln -sfn "$TODAY_DIR" "$LATEST_LINK"
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '????-??-??-*' -mtime +$KEEP_DAYS -exec rm -rf {} + 2>/dev/null || true

# ---------- 5. Optional: upload to remote storage ----------
# If you set REMOTE_UPLOAD_URL or rclone target, uncomment below.
# Example: REMOTE_UPLOAD_URL=s3://mybucket/boostly-backups
# if [ -n "${REMOTE_UPLOAD_URL:-}" ]; then
#   rclone copy "$TODAY_DIR" "$REMOTE_UPLOAD_URL/$DATE_TAG" || true
# fi

# ---------- Report ----------
echo
echo "================ BACKUP DONE ================"
echo "Path:        $TODAY_DIR"
echo "Dump size:   $DUMPSIZE"
echo "Latest link: $LATEST_LINK"
echo "Total used:  $(du -sh "$BACKUP_ROOT" | cut -f1)"
echo
echo "IMPORTANT: copy $SECRETS_FILE to a safe place (password manager)."
echo "Without the secrets file and PROVIDER_KEY_SECRET, data cannot be restored."
