#!/usr/bin/env bash
# =============================================================
# Fix user provider API keys on the self-hosted VPS backend.
#
# What it does (no secret copy-paste needed):
#  1. Logs in to the Lovable backend as an admin (email + password)
#  2. Asks the Lovable edge function `rekey-provider-keys` to re-encrypt
#     every user's provider API key with a BRAND NEW secret (generated here)
#     -> Lovable's own database is NOT modified (mode=export)
#  3. Writes those new ciphertexts into the VPS Postgres
#  4. Stores the new secret in the VPS edge-functions env and restarts it
#
# Usage (on VPS):
#   bash vps/fix-provider-keys.sh admin@gmail.com 'YourAdminPassword'
# =============================================================
set -euo pipefail

LOVABLE_URL="${LOVABLE_URL:-https://ejftttgovinaujrndona.supabase.co}"
LOVABLE_ANON="${LOVABLE_ANON:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqZnR0dGdvdmluYXVqcm5kb25hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NTMwOTcsImV4cCI6MjA5OTUyOTA5N30.hdqiPCxGd21WlPXYf4aXTDZ1Q5lgET_zshqFE22fYz0}"
STACK_DIR="${STACK_DIR:-/opt/supabase}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
WORK="/root/.rekey"

EMAIL="${1:-}"
PASSWORD="${2:-}"
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Usage: bash vps/fix-provider-keys.sh <admin-email> '<admin-password>'"
  exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "==> installing jq"; apt-get update -qq && apt-get install -y -qq jq; }

mkdir -p "$WORK"; chmod 700 "$WORK"

echo "==> 1/5 logging in as $EMAIL"
TOKEN=$(curl -s -X POST "$LOVABLE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $LOVABLE_ANON" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jq -r '.access_token // empty')
if [ -z "$TOKEN" ]; then echo "!! login failed (check email/password)"; exit 1; fi
echo "   login ok"

echo "==> 2/5 generating a new PROVIDER_KEY_SECRET"
NEW_SECRET=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)
echo "   generated (48 chars)"

echo "==> 3/5 exporting re-encrypted keys from Lovable"
RESP="$WORK/keys.json"
curl -s -X POST "$LOVABLE_URL/functions/v1/rekey-provider-keys" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg s "$NEW_SECRET" '{mode:"export", new_secret:$s}')" > "$RESP"
chmod 600 "$RESP"

if ! jq -e '.items' "$RESP" >/dev/null 2>&1; then
  echo "!! function error:"; cat "$RESP"; exit 1
fi
TOTAL=$(jq -r '.total' "$RESP"); OK=$(jq -r '.rekeyed' "$RESP"); BAD=$(jq -r '.failed' "$RESP")
echo "   providers: total=$TOTAL  re-encrypted=$OK  failed=$BAD"

echo "==> 4/5 writing keys into VPS database"
SQL="$WORK/apply.sql"
{
  echo "BEGIN;"
  jq -r '.items[] | "UPDATE public.user_provider_accounts SET api_key_ciphertext = " + (.api_key_ciphertext|@sh) + ", updated_at = now() WHERE id = " + (.id|@sh) + "::uuid;"' "$RESP"
  echo "COMMIT;"
} > "$SQL"
chmod 600 "$SQL"
docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$SQL" >/dev/null
echo "   database updated"

echo "==> 5/5 setting PROVIDER_KEY_SECRET on the VPS edge functions"
bash "$(dirname "$0")/set-function-secrets.sh" "PROVIDER_KEY_SECRET=$NEW_SECRET"

rm -f "$RESP" "$SQL"
echo
echo "=============================================="
echo " DONE. Ab site pe My Providers -> Test dabao."
echo " Providers fixed: $OK / $TOTAL"
echo "=============================================="
