#!/usr/bin/env bash
# Deploy PredictBot pe VPS. Izolat de /var/www/seap-app și de procesele DosarJust.
set -euo pipefail

HOST="${PREDICTBOT_HOST:-root@techdebeci.ro}"
KEY="${PREDICTBOT_SSH_KEY:-/tmp/opencode_key}"
REMOTE_DIR="${PREDICTBOT_REMOTE_DIR:-/var/www/predictbot}"

echo "→ verific că testele trec local"
npm test

echo "→ verific procesele DosarJust (nu le atingem)"
ssh -i "$KEY" "$HOST" "pm2 list | grep -i dosar || echo '  (niciun proces DosarJust)'"

echo "→ sincronizez codul în $REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude 'data/predictions/*.jsonl' \
  -e "ssh -i $KEY" ./ "$HOST:$REMOTE_DIR/"

echo "→ instalez dependențele și repornesc procesele proprii"
ssh -i "$KEY" "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --only predictbot-api
pm2 save
pm2 describe predictbot-crawler >/dev/null 2>&1 || pm2 start ecosystem.config.cjs --only predictbot-crawler
REMOTE

echo "→ health check"
ssh -i "$KEY" "$HOST" "curl -sf http://127.0.0.1:\${PORT:-3081}/health && echo"

echo "→ ultimele loguri"
ssh -i "$KEY" "$HOST" "pm2 logs predictbot-api --lines 20 --nostream"

echo "✓ deploy complet"
