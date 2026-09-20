# PredictBot — instrucțiuni pentru agent

Bot de predicții fotbal peste **PredictCamp API**, cu modele statistice proprii
(Dixon-Coles, Monte Carlo, Elo, Poisson), matematică de pariuri (de-vig, edge,
Kelly) și 7 personalități care decid diferit pe același meci.

## Flux obligatoriu
**cod → test → commit → push**. Niciun commit fără `npm test` verde.

```bash
npm test          # node --test, 67 teste
npm run lint      # node --check
```

## Arhitectură

```
Claude Agent (orchestrator)
  └── .claude/skills/          football-data · betting · markets  (commit-uite în repo)
  └── src/dataFetcher.js       PredictCamp public API v1
  └── src/models/              poisson · dixonColes · elo · monteCarlo · ensemble
  └── src/betting/             odds (devig Shin/proporțional) · kelly (edge, EV, arbitraj)
  └── src/bot/                 personalities · botLogic · reasoning
  └── src/server.js            HTTP API   /api/bots/:botId/predict
  └── src/cron/                botPredictCrawler.js (zilnic 06:00)
```

## PredictCamp API — ce trebuie știut

Base: `https://predictcamp.ro/api/public/v1` · autentificare: header **`X-Api-Key`** ·
locale: `X-Locale: ro` · rate limit: 120 req/min pe endpoint-urile de date.

| Endpoint | Ce întoarce | Capcane |
|---|---|---|
| `GET /matches` | listă + `consensus`, `ensemble_prediction`, `bot_agreement_pct` | filtre `status`, `league`, `from`, `to`, `page`, `limit` |
| `GET /matches/{slug}/models` | `poisson`, `elitul.dixon_coles`, `elitul.monte_carlo`, `elo`, `glicko2`, `ensemble`, `models_consensus` | **doar înainte de start**; după meci → `422 MODELS_NOT_AVAILABLE` |
| `GET /matches/{slug}/context` | H2H (ultimele 10), formă (ultimele 5/echipă), statistici sezon | cache 1h; `form_order: newest_first` |
| `GET /matches/{slug}/bot-predictions` | predicțiile boților PredictCamp + consensus | opțional pentru bot |
| `GET /matches/{slug}/ml-1x2` | probabilități ML calibrate | opțional |
| `GET /bots` | catalogul de boți PredictCamp | — |

**Probabilitățile din API sunt procente (0–100).** Intern lucrăm cu fracții (0–1);
conversia se face o singură dată, în `buildModelSources`.

`ensemble.prediction` e predicția autoritară a PredictCamp; `models_consensus`
raportează doar semnal de acord, nu o predicție.

Fără `PREDICTCAMP_API_KEY` toate endpoint-urile de date întorc `401 INVALID_API_KEY`.
Testele **nu** ating rețeaua — rulează pe `tests/fixtures/match-bundle.json`.

## Skill-uri instalate (`.claude/skills/`, commit-uite pentru sandbox)

Instalate din `machina-sports/sports-skills`. Sunt **documentație + CLI Python**
(`sports-skills <skill> <comandă>`); botul nu depinde de ele la runtime, dar
agentul le poate folosi pentru explorare.

- **`football-data`** — 21 de comenzi, 13 ligi (PL, La Liga, Bundesliga, Serie A,
  Ligue 1, CL, EL…): fixtures, clasamente, H2H, marcatori.
- **`betting`** — matematică pură, fără apeluri de rețea: `convert_odds`, `devig`,
  `find_edge`, `evaluate_bet`, `find_arbitrage`, `parlay_analysis`, `line_movement`.
- **`markets`** — prețuri Kalshi / Polymarket.

Reimplementate nativ în JS (`src/betting/`) ca să ruleze headless pe VPS fără Python.
Semantica e identică — dacă schimbi un skill, sincronizează și modulul JS + testele.

Reinstalare / actualizare:
```bash
npx -y skills add machina-sports/sports-skills --skill betting --agent claude-code
```

## Modele — decizii de design

- **Dixon-Coles**: `fitDixonColes` folosește **scaling iterativ multiplicativ**
  (IPF / EM pentru Poisson log-liniar), nu gradient descent. Gradientul numeric
  pe likelihood-ul complet derivă pe eșantioane mici (λ ajunge la clamp).
  ρ se estimează separat, prin grilă 1-D pe termenul τ, cu forțele fixate.
- **Identificabilitate**: media geometrică a atacurilor = 1, compensată în apărări.
  Fără asta, `attack + c` / `defence − c` lasă λ neschimbat și parametrii derivă.
- **Time decay**: `φ(t) = exp(-ξ·zile)`, ξ = 0.0065/zi (half-life ~107 zile).
- **Monte Carlo** eșantionează din **matricea Dixon-Coles**, nu din două Poisson
  independente — altfel se pierde corecția τ. PRNG determinist (mulberry32) cu seed.
- **De-vig**: implicit **Shin** (corectează favourite-longshot bias), rezolvat prin
  **bisecție** pe z. Proporțional e disponibil ca `method: 'proportional'`.
  Edge-ul se calculează întotdeauna vs probabilitatea de-vigată, niciodată vs cota brută.
- **Ensemble**: ponderi per personalitate, re-normalizate după excluderea surselor lipsă.

## Personalități (`src/bot/personalities.js`)

| id | stil | ponderi dominante | politică |
|---|---|---|---|
| `ai-analyst` | analitic, compară tot | DC 40 / Elo 30 / Poisson 20 / PC 10 | edge ≥ 3%, încredere ≥ 52% |
| `statisticianul` | conservator, medii | Poisson 45 / DC 30 | edge ≥ 4%, încredere ≥ 58%, fără egal |
| `forma-zilei` | momentum ultimele 5 | Elo 40 / DC 30 | edge ≥ 2%, încredere ≥ 50% |
| `istoricul` | H2H obsesiv | DC 35 / Poisson 25 | pondere H2H ≤ 25%, crește cu eșantionul |
| `matematicianul` | Dixon-Coles pur | DC 85 / Poisson 15 | include correct score |
| `value-hunter` | doar preț greșit | DC 35 / Elo 25 | **cere cote**, edge ≥ 5%, rank pe edge |
| `underdog-lover` | contrarian | DC 40 / Poisson 30 | exclude favoritul pe 1X2, cozi Monte Carlo |

Fiecare personalitate schimbă **trei** lucruri: ponderile de blending, ajustarea de
context (`adjust`), și politica de selecție + vocea. Diferențierea e verificată de test:
două personalități nu au voie să copieze aceeași selecție pe același meci.

## Reasoning
`src/bot/reasoning.js` **nu cheamă niciun LLM** — construiește textul din puncte de
date verificabile, ca să fie reproductibil și auditabil. Dacă adaugi o sursă de date,
adaugă și bullet-ul corespunzător.

## Comenzi

```bash
npm run upcoming                                   # meciuri în fereastra 2–48h
node src/cli.js predict <slug> --odds=2.10,3.40,3.60
node src/cli.js compare <slug> --odds=1.30,5.5,9.0 # toate personalitățile
node src/cli.js bots
npm run crawler                                    # generează + salvează predicții
npm run settle                                     # atașează rezultatele reale
npm run report                                     # leaderboard acuratețe/ROI
npm run backtest -- --refit --limit=200            # walk-forward Dixon-Coles
npm run serve                                      # HTTP API pe PORT (3081)
./scripts/deploy.sh                                # deploy pe 62.171.157.32
```

## Reguli

1. **Teste pentru orice modificare.** Matematica se testează cu valori analitice
   cunoscute, nu cu snapshot-uri.
2. **Nu chema rețeaua din teste.** Folosește fixture-ul.
3. **Probabilitățile trebuie să însumeze 1.** Există teste pentru asta în fiecare model.
4. **Serverul e partajat.** PredictBot trăiește în `/var/www/predictbot`, pe portul
   **3081**, cu procese PM2 proprii (`predictbot-api`, `predictbot-crawler`).
   Nu atinge DosarJust, SEAP, pretbox sau PredictCamp. Detalii de conectare,
   harta porturilor și pașii de deploy: **[.claude/server.md](.claude/server.md)**.
5. **Secretele nu se commit-ează.** `PREDICTCAMP_API_KEY` trăiește doar în
   `/var/www/predictbot/.env` (chmod 600) și în `.env`-ul local.
6. Commit: `tip(modul): descriere` — ex. `feat(models): adaugă Glicko-2`.
