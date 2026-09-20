# Server — PredictBot

Adaptat din `~/workspace/predictcamp/.opencode/skills/05-server-reference.md`.

## Acces SSH

```bash
ssh -i ~/.ssh/new_contabo root@62.171.157.32
```

- **Folosește IP-ul `62.171.157.32`**, nu hostname-ul `techdebeci.ro` — hostname-ul
  nu funcționează cu cheia SSH.
- Cheia stă permanent în `~/.ssh/new_contabo`. **Nu** în `/tmp` (se șterge la reboot).
- Dacă sesiunea rulează **deja pe server** (cwd `/var/www/predictbot`, host `vmi3242577`),
  execută comenzile direct — nu face SSH către tine însuți.

## Calea aplicației

```text
/var/www/predictbot          # repo clonat din git@github.com:skaliber/predictbot.git
/var/www/predictbot/.env     # secrete (chmod 600) — PREDICTCAMP_API_KEY
```

Serverul are deja acces SSH la GitHub ca `skaliber`, deci `git clone`/`git pull`
merg direct, fără token.

## Procese PM2 proprii

| Proces | Ce face | Port |
|---|---|---|
| `predictbot-api` | HTTP API (`/health`, `/api/bots/:botId/predict`) | **3081** |
| `predictbot-crawler` | cron zilnic 06:00 — generează predicții 2–48h | — |

Definite în `ecosystem.config.cjs`.

## ⛔ Ce NU se atinge

Serverul e partajat. Porturi ocupate de alte aplicații:

| Port | Proces | Atingem? |
|---|---|---|
| 3001 | DosarJust API (`dosar-api`) | ❌ |
| 3002 | SEAP API (`seap-api`) | ❌ |
| 3003 | ApiKeys Service | ❌ |
| 3004 | PredictCamp API (fallback PM2) | ❌ |
| 3007 / 3008 | PredictCamp Blue / Green (Docker) | ❌ |
| 3009 | ocupat | ❌ |
| 3010 / 3011 | pretbox Blue / Green | ❌ |
| 3100 | ocupat | ❌ |
| **3081** | **PredictBot API** | ✅ al nostru |

Procese PM2 care **nu** se opresc și nu se reconfigurează: `dosar-api`,
`dosar-api-test`, `seap-api`, `api-keys-service`, `agent-bot`, `umami`,
`ner-sidecar`, `mcp-topic-classifier`.

Înainte de orice `pm2 restart/reload`, folosește **`--only predictbot-api`** /
`--only predictbot-crawler`. Niciodată `pm2 restart all` sau `pm2 kill`.

## Deploy

```bash
./scripts/deploy.sh          # din repo local; rulează testele, apoi git pull pe server
```

Deploy-ul e prin **git pull**, nu rsync — serverul are `.git`. Pașii:
1. `npm test` local (abortează dacă pică),
2. verifică procesele DosarJust/PredictCamp (doar raportează, nu le atinge),
3. `git fetch && git reset --hard origin/main` în `/var/www/predictbot`,
4. `npm ci --omit=dev`,
5. `npm test` **pe server**, pe commit-ul deployat,
6. `pm2 startOrReload ecosystem.config.cjs --only predictbot-api`,
7. health check pe `http://127.0.0.1:3081/health`.

## Verificări după deploy

```bash
ssh -i ~/.ssh/new_contabo root@62.171.157.32 'curl -sf http://127.0.0.1:3081/health'
ssh -i ~/.ssh/new_contabo root@62.171.157.32 'pm2 logs predictbot-api --lines 30 --nostream'
ssh -i ~/.ssh/new_contabo root@62.171.157.32 'cd /var/www/predictbot && npm run report'
```

Rulare manuală a crawler-ului (fără să aștepți cron-ul):

```bash
ssh -i ~/.ssh/new_contabo root@62.171.157.32 'cd /var/www/predictbot && node src/cron/botPredictCrawler.js'
```

## Secrete

`PREDICTCAMP_API_KEY` trăiește **doar** în `/var/www/predictbot/.env` (chmod 600).
Nu se commit-ează niciodată — `.env` e în `.gitignore`. Dacă o cheie ajunge
într-un commit, în chat sau într-un log, se revocă și se regenerează din
PredictCamp, nu se „curăță" din istoric.
