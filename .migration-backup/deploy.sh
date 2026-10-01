#!/usr/bin/env bash
# ============================================================
#  Boostly Pro - VPS Deploy Script (Ubuntu / Debian)
#  Chalane ka tarika (VPS me root se):
#    bash deploy.sh
#  ya:
#    curl -fsSL https://raw.githubusercontent.com/USER/REPO/main/deploy.sh | bash
# ============================================================
set -euo pipefail

# ---------- SETTINGS (yahan apni details daalo) ----------
REPO_URL="${REPO_URL:-https://github.com/lvesachin-crypto/bosstlypro.git}"
DOMAIN="${DOMAIN:-boostbotting.site}"
EMAIL="${EMAIL:-admin@boostbotting.site}"
APP_DIR="/var/www/boostly"
# ---------------------------------------------------------

echo ""
echo "==> 1/6  System update + zaroori packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx unzip ca-certificates

echo ""
echo "==> 2/6  Node.js 20 install"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo ""
echo "==> 3/6  Code clone / update"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all
  git -C "$APP_DIR" reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo ""
echo "==> 4/6  Build (npm ci + npm run build)"
if [ ! -f .env ]; then
  echo "!! .env file missing. Lovable project ki .env yahan copy karo: $APP_DIR/.env"
  echo "   Usme VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PROJECT_ID hone chahiye."
  exit 1
fi
npm ci || npm install
npm run build

echo ""
echo "==> 5/6  Nginx config (SPA fallback + cache)"
cat > /etc/nginx/sites-available/boostly <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    root ${APP_DIR}/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/boostly /etc/nginx/sites-enabled/boostly
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "==> 6/6  Free SSL (Let's Encrypt)"
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" \
  --non-interactive --agree-tos -m "${EMAIL}" --redirect || \
  echo "!! SSL fail hua - DNS A record ${DOMAIN} -> is VPS ke IP pe point karo, phir chalao: certbot --nginx -d ${DOMAIN}"

echo ""
echo "============================================"
echo " DONE! Site live: https://${DOMAIN}"
echo " Update ke liye dobara chalao: bash $APP_DIR/deploy.sh"
echo "============================================"
