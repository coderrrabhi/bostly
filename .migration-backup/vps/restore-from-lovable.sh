#!/usr/bin/env bash
# One-command restore: downloads the latest Lovable database export and restores
# it into the self-hosted Supabase Postgres container on this VPS.
#
# Usage:  bash vps/restore-from-lovable.sh <TOKEN>
set -euo pipefail

TOKEN="${1:-${BACKUP_LINK_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "Usage: bash vps/restore-from-lovable.sh <TOKEN>"
  exit 1
fi

FN_URL="https://ejftttgovinaujrndona.supabase.co/functions/v1/backup-link?k=${TOKEN}"
OUT=/root/lovable.backup

echo "==> downloading latest backup"
curl -fL --retry 3 -o "$OUT" "$FN_URL"
ls -lh "$OUT"

echo "==> copying into database container"
docker cp "$OUT" supabase-db:/tmp/l.backup

PGPASS="$(grep POSTGRES_PASSWORD /root/.boostly-secrets | cut -d= -f2)"

echo "==> restoring"
docker exec -e PGPASSWORD="$PGPASS" supabase-db \
  pg_restore -U postgres -d postgres --no-owner --no-privileges --clean --if-exists /tmp/l.backup || true

echo "==> done. verifying user count"
docker exec -e PGPASSWORD="$PGPASS" supabase-db \
  psql -U postgres -d postgres -c "select count(*) as users from auth.users;" || true
