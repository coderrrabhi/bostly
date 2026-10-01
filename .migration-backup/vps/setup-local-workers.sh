#!/usr/bin/env bash
# Install VPS-local dispatch/status workers after restoring the Lovable database.
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/supabase}"
SECRETS_FILE="${SECRETS_FILE:-/root/.boostly-secrets}"
API_URL="${API_URL:-https://api.boostbotting.site}"
WORKER="/usr/local/sbin/boostly-worker"
CRON_FILE="/etc/cron.d/boostly-workers"

if [ ! -r "$SECRETS_FILE" ]; then
  echo "Missing $SECRETS_FILE" >&2
  exit 1
fi

# Disable restored pg_cron HTTP jobs that still point at the old cloud backend.
# Some restored stacks keep cron.job owned by supabase_admin, so this cleanup is
# best-effort and must never prevent the VPS-local workers from being installed.
if docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    UPDATE cron.job
    SET active = false
    WHERE command ILIKE '%execute-all-runs%'
       OR command ILIKE '%check-order-status%';
  END IF;
END $$;
SQL
then
  echo "==> old cloud cron workers disabled"
else
  echo "==> warning: old pg_cron jobs could not be disabled; continuing with local workers" >&2
fi

cat > "$WORKER" <<'WORKER_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
. /root/.boostly-secrets

ACTION="${1:-}"
case "$ACTION" in
  dispatch) ENDPOINT="execute-all-runs"; TIMEOUT=150 ;;
  status) ENDPOINT="check-order-status"; TIMEOUT=150 ;;
  *) echo "Usage: $0 dispatch|status" >&2; exit 2 ;;
esac

exec curl --silent --show-error --fail \
  --max-time "$TIMEOUT" \
  --request POST "https://api.boostbotting.site/functions/v1/$ENDPOINT" \
  --header "Authorization: Bearer $SERVICE_ROLE_KEY" \
  --header "apikey: $SERVICE_ROLE_KEY" \
  --header "Content-Type: application/json" \
  --data '{}'
WORKER_SCRIPT
chmod 700 "$WORKER"

cat > "$CRON_FILE" <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

* * * * * root flock -n /run/boostly-dispatch.lock /usr/local/sbin/boostly-worker dispatch >> /var/log/boostly-dispatch.log 2>&1
* * * * * root sleep 30; flock -n /run/boostly-status.lock /usr/local/sbin/boostly-worker status >> /var/log/boostly-status.log 2>&1
CRON
chmod 644 "$CRON_FILE"

systemctl enable --now cron

echo "==> testing VPS-local status worker now"
if flock -n /run/boostly-status.lock "$WORKER" status >/tmp/boostly-status-test.log 2>&1; then
  echo "Automatic provider status worker is live."
else
  cat /tmp/boostly-status-test.log >&2
  echo "Status worker test failed; inspect /var/log/boostly-status.log" >&2
  exit 1
fi

echo "==> schedules installed"
echo "dispatch: every 60 seconds"
echo "status: every 60 seconds (staggered by 30 seconds)"