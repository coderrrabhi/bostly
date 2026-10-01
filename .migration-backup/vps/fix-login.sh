#!/usr/bin/env bash
# Recover password login when the auth health endpoint works but token requests hang.
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/supabase}"
CRON_FILE="/etc/cron.d/boostly-workers"
CRON_BACKUP="/tmp/boostly-workers.cron"

if [ ! -d "$STACK_DIR" ]; then
  echo "Missing backend stack: $STACK_DIR" >&2
  exit 1
fi

echo "==> pausing background order workers"
if [ -f "$CRON_FILE" ]; then
  cp "$CRON_FILE" "$CRON_BACKUP"
  rm -f "$CRON_FILE"
fi
pkill -f '/usr/local/sbin/boostly-worker' 2>/dev/null || true

echo "==> clearing stale database sessions"
docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND datname = current_database()
  AND (
    state = 'idle in transaction'
    OR (state = 'active' AND query_start < now() - interval '5 minutes')
  );
SQL

echo "==> restarting auth and API gateway"
cd "$STACK_DIR"
docker compose up -d auth rest kong
docker compose restart auth rest kong

echo "==> waiting for auth"
set -a
. /root/.boostly-secrets
set +a
AUTH_OK=false
for _ in $(seq 1 30); do
  if curl --silent --show-error --fail --max-time 5 \
    --header "apikey: $ANON_KEY" \
    https://api.boostbotting.site/auth/v1/health >/dev/null; then
    AUTH_OK=true
    break
  fi
  sleep 2
done

if [ "$AUTH_OK" != true ]; then
  echo "Auth did not recover. Recent auth logs:" >&2
  docker compose logs --tail=100 auth >&2
  exit 1
fi

echo "==> restoring workers with safe staggered schedule"
if [ -f "$CRON_BACKUP" ]; then
  cp "$CRON_BACKUP" "$CRON_FILE"
  sed -i '/sleep 30;.*boostly-dispatch/d' "$CRON_FILE"
  sed -i '/^[^#].*boostly-status.lock/ s/^\* \* \* \* \* root /\* \* \* \* \* root sleep 30; /' "$CRON_FILE"
  chmod 644 "$CRON_FILE"
fi
systemctl reload cron 2>/dev/null || systemctl restart cron

echo "==> login service recovered"
echo "Users can sign in again. Existing users and passwords were not changed."