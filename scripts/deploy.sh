#!/usr/bin/env bash
# Deploy PredictBot pe VPS-ul partajat (62.171.157.32) prin git pull.
# Izolat de PredictCamp, SEAP și DosarJust — vezi .claude/server.md.
set -euo pipefail

HOST="${PREDICTBOT_HOST:-root@62.171.157.32}"
KEY="${PREDICTBOT_SSH_KEY:-$HOME/.ssh/new_contabo}"
REMOTE_DIR="${PREDICTBOT_REMOTE_DIR:-/var/www/predictbot}"
BRANCH="${PREDICTBOT_BRANCH:-main}"
PORT="${PREDICTBOT_PORT:-3081}"

ssh_run() { ssh -i "$KEY" "$HOST" "$@"; }

echo "→ [1/6] teste locale"
npm test >/dev/null
echo "  ✓ teste verzi"

echo "→ [2/6] commit-ul local e pushed?"
git diff --quiet HEAD -- || { echo "  ✗ ai modificări necommit-uite"; exit 1; }
git fetch -q origin "$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || {
  echo "  ✗ HEAD local diferă de origin/$BRANCH — dă push întâi"; exit 1; }
echo "  ✓ $(git rev-parse --short HEAD) e pe origin/$BRANCH"

echo "→ [3/6] procese vecine (doar raportare, nu le atingem)"
ssh_run "pm2 list --no-color | grep -iE 'dosar|seap|pretbox|predictcamp' || echo '  (niciunul)'"

echo "→ [4/6] git pull + dependențe + teste pe server"
ssh_run bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
git fetch --all --quiet
git reset --hard "origin/$BRANCH"
npm ci --omit=dev --silent
npm ci --silent --include=dev >/dev/null 2>&1 || true
npm test >/dev/null && echo "  ✓ teste verzi pe server ($(git rev-parse --short HEAD))"
REMOTE

echo "→ [5/6] repornesc DOAR procesele predictbot"
ssh_run bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
pm2 startOrReload ecosystem.config.cjs --only predictbot-api
pm2 describe predictbot-crawler >/dev/null 2>&1 || pm2 start ecosystem.config.cjs --only predictbot-crawler
pm2 save >/dev/null
REMOTE

echo "→ [6/6] health check"
ssh_run "curl -sf http://127.0.0.1:$PORT/health" && echo
echo "✓ deploy complet"
