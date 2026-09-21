# predictbot

Bot de predicții fotbal construit peste [PredictCamp](https://predictcamp.ro):
modele statistice proprii (Dixon-Coles cu time decay, Monte Carlo 10k, Elo, Poisson),
matematică de pariuri (de-vig Shin, edge, Kelly criterion) și **7 personalități**
care ajung la concluzii diferite pe același meci — fiecare cu reasoning explicit.

```
┌─────────────────────────────────────────┐
│  Claude Agent (orchestrator)            │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  .claude/skills/  (machina-sports)      │
│  football-data · betting · markets      │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  predictbot                             │
│  models/ · betting/ · bot/ · server.js  │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  PredictCamp API  /api/public/v1        │
│  /models · /context · /bots · /ml-1x2   │
└─────────────────────────────────────────┘
```

## Instalare

```bash
git clone git@github.com:skaliber/predictbot.git
cd predictbot
npm install
cp .env.example .env    # completează PREDICTCAMP_API_KEY
npm test
```

Skill-urile sunt deja în `.claude/skills/` (commit-uite), deci repo-ul rulează
direct într-un sandbox, fără acces la rețea pentru instalare.

## Utilizare

```bash
npm run upcoming                                     # meciuri în fereastra 2–48h
node src/cli.js predict <slug> --odds=2.10,3.40,3.60 # 1X2
node src/cli.js compare <slug> --odds=1.30,5.5,9.0   # toate personalitățile
node src/cli.js bots                                 # catalogul de personalități
```

Exemplu de ieșire (`compare`, cote 1.30 / 5.50 / 9.00 pe Rangers–Kilmarnock):

```
Matematicianul  →  Peste 2.5 goluri  @ 68.6%   edge +14.4pp  EV +20.0%  Kelly 5.00%
Underdog Lover  →  Victorie oaspeți  @ 16.7%   edge  +7.2pp  EV +50.0%  Kelly 0.94%
Statisticianul  →  Peste 2.5 goluri  @ 58.4%   edge  +4.2pp  EV  +2.1%  Kelly 0.42%
```

## Ieșirea botului

```json
{
  "slug": "premier-league-man-city-vs-arsenal-2026-10-04",
  "bot": { "id": "ai-analyst", "name": "AI Analyst" },
  "prediction": "Peste 2.5 goluri (Over 2.5)",
  "confidence": 64.4,
  "edge_pct": 10.2,
  "ev_percent": 12.7,
  "kelly_stake": 0.0424,
  "models_used": ["dixonColes", "elo", "poisson", "predictcamp"],
  "reasoning": {
    "summary": "Am comparat modelele înainte să decid. Aleg Peste 2.5 goluri...",
    "bullets": [
      "Dixon-Coles: λ 2.71 − 1.02 (3.73 goluri așteptate, scor cel mai probabil 2-0)",
      "Monte Carlo 10.000 simulări: 1 73.8% / X 14.9% / 2 11.3%, Over 2.5 73.6%",
      "Piață: cota 1.75 implică 54.2% după de-vig (vig 4.1%); modelul spune 64.4% → edge +10.2pp"
    ]
  }
}
```

## Modele

| Model | Implementare |
|---|---|
| **Poisson** | baseline Maher (1982), matrice de scoruri normalizată |
| **Dixon-Coles** | corecție τ pentru scoruri mici, time decay `exp(-ξ·zile)`, fit prin scaling iterativ multiplicativ, ρ prin grilă 1-D |
| **Elo** | avantaj teren propriu, egal derivat din diferența de rating, K scalat pe marjă |
| **Monte Carlo** | eșantionare din matricea Dixon-Coles (păstrează τ), PRNG determinist cu seed |
| **Ensemble** | blending ponderat per personalitate, re-normalizare la surse lipsă |

## Pariuri

`devig` (Shin prin bisecție, sau proporțional), `findEdge`, `kelly` (fracționat +
plafonat), `evaluateBet`, `findArbitrage`, `parlayAnalysis`. Edge-ul se calculează
**întotdeauna** față de probabilitatea de-vigată, niciodată față de cota brută.

## API HTTP

```
GET  /health
GET  /api/bots
POST /api/bots/:botId/predict          { matchSlug, odds?, oddsFormat?, persist? }
GET  /api/bots/:botId/predict/:slug
GET  /api/bots/:botId/history          → acuratețe, ROI Kelly, ROI flat, split pe piață
```

## Cât de bun e, de fapt

Backtest walk-forward pe 824 de meciuri, 5 ligi, sezonul 2025/26: **modelul e
în urma pieței în toate ligile**, cu 1.8–7.6% pe RPS. Bate reperul naiv, dar
nu bookmakerul — deci nu are edge sistematic. Cifre complete și metodologie
în [BACKTEST.md](BACKTEST.md).

Pragurile SAFE/MODERATE/RISKY **nu sunt încă validate pe date**.

## Evaluare

```bash
npm run crawler    # generează predicții pentru fereastra 2–48h
npm run settle     # atașează rezultatele reale după meciuri
npm run report     # leaderboard: acuratețe, ROI Kelly, ROI flat
npm run backtest -- --refit --limit=200   # walk-forward: Brier + RPS
```

Metrici: **acuratețe 1X2**, **Brier score**, **RPS** (Ranked Probability Score,
metrica standard pentru rezultate ordonate), **ROI Kelly** și **ROI flat 1u**.

## Deploy

```bash
./scripts/deploy.sh          # teste → git pull pe server → npm ci → teste → pm2 reload
```

Rulează în `/var/www/predictbot` pe `62.171.157.32`, portul **3081**.
PM2: `predictbot-api` (HTTP) și `predictbot-crawler` (cron 06:00).
Izolat de PredictCamp (3007/3008), SEAP, DosarJust și pretbox de pe același VPS —
vezi [.claude/server.md](.claude/server.md).

## Licență

Privat. Skill-urile din `.claude/skills/` sunt MIT (machina-sports/sports-skills).
