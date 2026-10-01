#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/supabase}"
ENV_FILE="$STACK_DIR/functions.env"
OVERRIDE="$STACK_DIR/docker-compose.boostly-secrets.yml"

mkdir -p "$STACK_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

if [ "$#" -eq 0 ]; then
  if [ ! -s "$ENV_FILE" ]; then
    echo "No secrets are stored in $ENV_FILE yet." >&2
    exit 1
  fi
  echo "==> reusing secrets already stored in $ENV_FILE"
fi

for pair in "$@"; do
  key="${pair%%=*}"
  val="${pair#*=}"
  grep -v "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "   set $key"
done
chmod 600 "$ENV_FILE"

cat > "$OVERRIDE" <<YML
services:
  functions:
    env_file:
      - ./functions.env
YML
chmod 600 "$OVERRIDE"

echo "==> recreating edge functions with stored secrets"
cd "$STACK_DIR"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.boostly-secrets.yml \
  up -d --force-recreate functions

echo "==> verifying PROVIDER_KEY_SECRET inside edge functions"
for _ in $(seq 1 15); do
  CONTAINER_ID=$(docker compose \
    -f docker-compose.yml \
    -f docker-compose.boostly-secrets.yml \
    ps -q functions 2>/dev/null || true)
  if [ -n "$CONTAINER_ID" ] && docker exec "$CONTAINER_ID" sh -c 'test -n "$PROVIDER_KEY_SECRET"' 2>/dev/null; then
    echo "PROVIDER_KEY_SECRET loaded successfully"
    echo "==> done"
    exit 0
  fi
  sleep 1
done

echo "PROVIDER_KEY_SECRET is still unavailable in edge functions." >&2
echo "Run: docker logs --tail 100 supabase-edge-functions" >&2
exit 1
