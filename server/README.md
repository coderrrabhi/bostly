# Boostly Pro — self-hosted server

Express + PostgreSQL (node-postgres). Serves `/api/*`, runs the order dispatch /
status-check workers, and (in production) serves the built frontend.

## Setup on a Linux VPS
    sudo apt install -y postgresql nodejs npm
    sudo -u postgres createuser -P boostly && sudo -u postgres createdb -O boostly boostly
    cp server/.env.example server/.env   # fill in values
    export $(grep -v '^#' server/.env | xargs)
    psql "$DATABASE_URL" -f schema.sql   # tables, indexes, triggers, seed data
    cd server && npm install && npm run build
    npm start                            # listens on $PORT (default 3000)

Build the frontend (`pnpm --filter @workspace/boostly-pro run build`) so the server
can serve it from `artifacts/boostly-pro/dist/public`, or set `STATIC_DIR`.
If the frontend is hosted elsewhere, build it with `VITE_API_URL=https://your-server/api`.

Cleanup cron (optional):
    */30 * * * * psql "$DATABASE_URL" -c "SELECT lovable_legacy.cleanup_old_completed_engagement_orders()"

Keep it running with pm2 or systemd: `pm2 start "npm start" --name boostly --cwd server`.
Moving existing users: see `scripts/import-users.md`.
