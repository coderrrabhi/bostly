#!/usr/bin/env bash
# =============================================================
# One-command update for the VPS (frontend + edge functions)
# Usage (on VPS):
#   cd /var/www/boostly && bash vps/deploy-update.sh
# =============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/boostly}"
STACK_DIR="${STACK_DIR:-/opt/supabase}"

echo "==> 1/4 pulling latest code"
cd "$APP_DIR"
git pull --ff-only

echo "==> 2/4 building frontend"
if command -v bun >/dev/null 2>&1; then
  bun install && bun run build
else
  (npm ci || npm install --no-audit --no-fund) && npm run build
fi

echo "==> 3/4 syncing edge functions into the Supabase stack"
mkdir -p "$STACK_DIR/volumes/functions"
cp -r supabase/functions/. "$STACK_DIR/volumes/functions/"
if [ -f "$STACK_DIR/docker-compose.boostly-secrets.yml" ]; then
  ( cd "$STACK_DIR" && docker compose \
      -f docker-compose.yml \
      -f docker-compose.boostly-secrets.yml \
      up -d --force-recreate functions )
else
  ( cd "$STACK_DIR" && docker compose up -d --force-recreate functions )
fi

echo "==> 4/4 reloading nginx"
nginx -t && systemctl reload nginx

echo
echo "==> containers:"
( cd "$STACK_DIR" && docker compose ps --format '{{.Name}}  {{.Status}}' ) || docker ps --format '{{.Names}}  {{.Status}}'
echo "==> done. open https://boostbotting.site"
