#!/usr/bin/env bash
# =============================================================
# Boostly Pro — FULL SELF-HOST (Backend + Database) on VPS
# Ubuntu 22.04 / 24.04, run as root
#   bash selfhost-backend.sh
# =============================================================
set -euo pipefail

# ---------- CONFIG (edit these) ----------
DOMAIN="boostbotting.site"          # frontend domain
API_DOMAIN="api.boostbotting.site"  # backend (Supabase) domain
EMAIL="you@example.com"             # for Let's Encrypt
GIT_REPO="https://github.com/lvesachin-crypto/bosstlypro.git"   # public repo; private repo ke liye https://<TOKEN>@github.com/... use karo 
STACK_DIR="/opt/supabase"
APP_DIR="/var/www/boostly"
# -----------------------------------------

need() { command -v "$1" >/dev/null 2>&1; }

echo "==> 1/8 base packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg ufw nginx openssl jq postgresql-client

echo "==> 2/8 docker"
if ! need docker; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> 3/8 node 20 + bun"
if ! need node; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
need bun || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

echo "==> 4/8 supabase self-host stack"
if [ ! -d "$STACK_DIR" ]; then
  git clone --depth 1 https://github.com/supabase/supabase "$STACK_DIR-src"
  mkdir -p "$STACK_DIR"
  cp -r "$STACK_DIR-src/docker/." "$STACK_DIR/"
  rm -rf "$STACK_DIR-src"
fi
cd "$STACK_DIR"
[ -f .env ] || cp .env.example .env

# --- generate secrets (only once) ---
if [ ! -f /root/.boostly-secrets ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  DASHBOARD_PASSWORD="$(openssl rand -hex 12)"
  # ANON / SERVICE keys must be signed with JWT_SECRET
  gen_key() { # $1 = role
    GK_ROLE="$1" GK_SECRET="$JWT_SECRET" node -e '
      const crypto=require("crypto");
      const role=process.env.GK_ROLE, secret=process.env.GK_SECRET;
      if(!role||!secret){console.error("gen_key: missing role/secret");process.exit(1);}
      const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
      const now=Math.floor(Date.now()/1000);
      const h=b64({alg:"HS256",typ:"JWT"});
      const p=b64({role,iss:"supabase",iat:now,exp:now+60*60*24*365*10});
      const s=crypto.createHmac("sha256",secret).update(h+"."+p).digest("base64url");
      process.stdout.write(h+"."+p+"."+s);
    '
  }

  ANON_KEY="$(gen_key anon)"
  SERVICE_ROLE_KEY="$(gen_key service_role)"
  cat > /root/.boostly-secrets <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
EOF
  chmod 600 /root/.boostly-secrets
fi
# shellcheck disable=SC1091
set -a; . /root/.boostly-secrets; set +a

set_env() { # key value
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}
set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_env JWT_SECRET "$JWT_SECRET"
set_env ANON_KEY "$ANON_KEY"
set_env SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_env DASHBOARD_USERNAME "$DASHBOARD_USERNAME"
set_env DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD"
set_env SITE_URL "https://$DOMAIN"
set_env API_EXTERNAL_URL "https://$API_DOMAIN"
set_env SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
set_env ADDITIONAL_REDIRECT_URLS "https://$DOMAIN,https://www.$DOMAIN"
set_env ENABLE_EMAIL_AUTOCONFIRM "true"
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_ANONYMOUS_USERS "false"
set_env DISABLE_SIGNUP "false"
set_env STUDIO_DEFAULT_PROJECT "Boostly Pro"

docker compose pull
docker compose up -d
echo "   waiting for postgres..."
for i in $(seq 1 60); do
  docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 3
done

echo "==> 5/8 app repo + build"
if [ -n "$GIT_REPO" ]; then
  [ -d "$APP_DIR/.git" ] || git clone "$GIT_REPO" "$APP_DIR"
  cd "$APP_DIR" && git pull --ff-only || true
  cat > "$APP_DIR/.env" <<EOF
VITE_SUPABASE_URL=https://$API_DOMAIN
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
EOF
  bun install || npm ci
  bun run build || npm run build
else
  echo "   GIT_REPO empty — frontend build skipped"
fi

echo "==> 6/8 nginx"
cat > /etc/nginx/sites-available/boostly <<NGINX
server {
  listen 80;
  server_name $DOMAIN www.$DOMAIN;
  root $APP_DIR/dist;
  index index.html;
  gzip on; gzip_types text/css application/javascript application/json image/svg+xml;
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
  location / { try_files \$uri \$uri/ /index.html; }
}
server {
  listen 80;
  server_name $API_DOMAIN;
  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/boostly /etc/nginx/sites-enabled/boostly
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> 7/8 firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
yes | ufw enable || true

echo "==> 8/8 SSL"
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -n --agree-tos -m "$EMAIL" \
  -d "$DOMAIN" -d "www.$DOMAIN" -d "$API_DOMAIN" || \
  echo "   certbot failed — check DNS A records point to this VPS"

echo
echo "================ DONE ================"
echo "Frontend : https://$DOMAIN"
echo "Backend  : https://$API_DOMAIN"
echo "Studio   : http://$(curl -s ifconfig.me):8000  (user: $DASHBOARD_USERNAME)"
echo "Secrets  : /root/.boostly-secrets"
echo
echo "NEXT: import your schema + data ->  bash vps/import-data.sh"
