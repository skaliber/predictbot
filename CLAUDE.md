# PredictBot — instrucțiuni pentru agent

Bot de predicții fotbal peste **PredictCamp API**, cu modele statistice proprii
(Dixon-Coles, Monte Carlo, Elo, Poisson), matematică de pariuri (de-vig, edge,
Kelly) și 7 personalități care decid diferit pe același meci.

## Flux obligatoriu
**cod → test → commit → push**. Niciun commit fără `npm test` verde.

```bash
npm test          # node --test
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
| `GET /matches` | listă + `consensus`, `ensemble_prediction`, `bot_agreement_pct` | **`limit` max 50** (peste → 400); `from`/`to` doar `YYYY-MM-DD`. `listMatches` paginează automat |
| `GET /matches/{slug}/models` | `poisson`, `elitul.dixon_coles`, `elitul.monte_carlo`, `elo`, `glicko2`, `ensemble`, `models_consensus` | **doar înainte de start**; după meci → `422 MODELS_NOT_AVAILABLE` |
| `GET /matches/{slug}/context` | H2H (ultimele 10), formă (ultimele 5/echipă), statistici sezon | cache 1h; `form_order: newest_first` |
| `GET /matches/{slug}/bots` | predicțiile boților PredictCamp | **nu** `/bot-predictions` — calea aia nu există (500) |
| `GET /matches/{slug}/ml-1x2` | probabilități ML calibrate | doar PL/LaLiga/Bundesliga/Serie A/Ligue 1; 404 în rest sau când modelul e oprit |
| `GET /matches/{slug}/corner-card-trends` | medii colțuri/cartonașe/șuturi, linii, încredere | `eligible: false` pe ligile fără acoperire |
| `GET /matches/{slug}/granular-stats` | Over/Under, BTTS, forme, goluri pe minut, poziție | fiecare secțiune e nullable independent |
| `GET /bots` | catalogul de boți PredictCamp | — |

### Cotele vin din API, dar numai pe chei cu scope admin

`GET /matches` și `GET /matches/{slug}` întorc `market_odds` (1X2 de la
livescore) **doar** dacă `user_api_keys.scope = 'admin'`. Pe o cheie publică
câmpul lipsește complet — de aceea nu apare în specul OpenAPI public.

```json
"market_odds": { "odds_1": 1.25, "odds_x": 5, "odds_2": 11,
                 "source": "livescore", "updated_at": "..." }
```

Ordinea de precedență a cotelor în bot:
1. cote explicite (`--odds` la CLI, `odds` în body-ul POST) → `odds_source: "furnizate"`
2. `market_odds` din bundle → `odds_source: "predictcamp_market_odds"`
3. niciuna → `edge_pct`/`kelly_stake` rămân `null`, selecția merge pe încredere

Nu orice meci are cote — sunt disponibile în principal pe ligile mari, și
lipsesc pentru fixture-uri îndepărtate. `value-hunter` **refuză** să parieze
fără cote, by design.

**Rolul ≠ scope-ul.** `users.role = 'admin'` ridică limitele (rate limit, cotă
zilnică, plafon de pagină); `user_api_keys.scope = 'admin'` dă acces la
`market_odds`. Sunt privilegii independente.

### Rate limit: 120/min public, 6000/min pe conturi admin

Un bundle costă până la 5 cereri. Refetch-ul per personalitate înmulțea costul
cu 7 și epuiza fereastra după ~3 meciuri. **Fetch-ul se face o singură dată per
meci** (`predictMatchForBots`) și se refolosește la toate personalitățile.
`src/lib/rateLimiter.js` ține un token bucket (`API_MAX_RPM`, implicit 100), iar
un 429 blochează tot procesul până expiră `ratelimit-reset`. Pe cheie admin
poate urca la 1000+ — plafonul serverului e 6000/min.

Atenție: limitarea per cheie a fost reparată în spec 087. Înainte, limiterul
rula *înaintea* autentificării, deci „120/min/cheie" era de fapt 120/min/IP.

`limit` la `/matches` e plafonat la **50** pe chei normale și **500** pe conturi
admin — `listMatches` paginează automat oricum.

**Probabilitățile din API sunt procente (0–100).** Intern lucrăm cu fracții (0–1);
conversia se face o singură dată, în `buildModelSources`.

`ensemble.prediction` e predicția autoritară a PredictCamp; `models_consensus`
raportează doar semnal de acord, nu o predicție.

**`single_source` — acord care nu e consens.** Pe meciurile fără bază de ligă
(naționale: Liga Națiunilor, preliminarii) toate modelele PredictCamp derivă din
același rating Elo (eloratings.net). API-ul semnalează asta prin
`models_consensus.reason = 'single_source'` și/sau `ensemble.single_source = true`.
Atunci „100% acord" e un singur vot repetat: `screening.isSingleSource()` îl
detectează, `CONSENSUS_VS_MARKET` devine `SINGLE_SOURCE_VS_MARKET` (`downgrade`),
iar `safetyScore` nu mai dă bonus de acord. **Nu** raporta aceste cazuri
platformei drept bug de calibrare — e comportament documentat.

Fix PredictCamp (25 sep 2026, verificat în producție pe 30 de meciuri NL):
λ gazdă și λ oaspete ies acum exact din formulă (înainte gazda primea ×0.970 pe
toate), avantajul terenului e din nou +50 Elo întreg în Poisson/MC/DC/boți,
iar Peste 2.5 pe meciurile echilibrate a urcat cu ~1 pp. Când modelul dă
oaspetele favorit contra pieței (Italia–Belgia, Ungaria–Ucraina), cauza e
diferența Elo (Belgia +78, Ucraina +70), nu un bug. Regula de pauză lungă
(×0.97 doar pe gazdă) rămâne asimetrică pe cluburi până se măsoară pe istoric.

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

## Skill-ul `/bets`

`.claude/skills/bets/SKILL.md` + `scripts/betslips.js` + `src/bot/screening.js`.

Împărțirea e intenționată: **scriptul face calculul determinist** (filtrare,
reguli de excludere, scoring, compunerea biletelor), **skill-ul spune agentului
cum să interpreteze** flag-urile și cum să prezinte. Regulile de screening sunt
testate (`tests/screening.test.js`) — nu le muta în prompt.

Flag-uri cu `severity: exclude` scot pick-ul; `downgrade` îl coboară din SAFE;
`note` doar se raportează. Dacă adaugi o regulă nouă, adaug-o în
`src/bot/screening.js` cu test, nu în SKILL.md.

## Comenzi

```bash
npm run upcoming                                   # meciuri în fereastra 2–48h
node src/cli.js predict <slug> --odds=2.10,3.40,3.60
node src/cli.js compare <slug> --odds=1.30,5.5,9.0 # toate personalitățile
node src/cli.js bots
npm run crawler                                    # generează + salvează predicții
npm run settle                                     # atașează rezultatele reale
npm run report                                     # leaderboard acuratețe/ROI
npm run bets -- --hours=48 --markdown              # bilete (motorul pentru /bets)
npm run backtest -- --refit --limit=200            # walk-forward Dixon-Coles
npm run serve                                      # HTTP API pe PORT (3081)
./scripts/deploy.sh                                # deploy pe 62.171.157.32
```

## Capcane de operare

- **Rulează scripturile direct, nu prin `npm run`**, când parsezi ieșirea: npm
  scrie bannerul (`> predictbot@0.1.0 settle`) pe stdout și strică JSON-ul.
  `node scripts/settle.js | jq` ✅ — `npm run settle | jq` ❌.
- **Log-urile merg pe stderr**, la toate nivelurile. stdout e doar pentru
  rezultatul programului.
- `npm test` folosește `node --test tests/*.test.js` — globul intern al `--test`
  există doar din Node 22, iar serverul are Node 20.

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
