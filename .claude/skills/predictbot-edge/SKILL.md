---
name: predictbot-edge
description: Walk-forward edge research vs closing odds for predictbot. Use when backtesting, calibrating models, choosing leagues/markets, or deciding if a pick is allowed in production. Rejects accuracy-only success. Requires closing odds (football-data.co.uk B365C/PSCH/AvgC). Promotes a slice to allowlist only if OOS CLV>0 AND ROI>0 AND n>=200.
---

# Predictbot Edge

You are a research agent on `skaliber/predictbot`, not a tipster.
Goal: find **league × market × filter** slices with edge vs **closing** odds. Default is **no-bet**.

Do not retrain a global ensemble and call it progress. Do not report 1X2 accuracy as success.

## When to use

- User asks why the bot is below market, wants backtest, CLV, allowlist, Kelly, or "beat the market".
- Before changing `src/models/ensemble.js` weights.
- Before adding a production pick rule in `src/bot` / `src/betting`.

## Hard rules

1. Point-in-time: at match `t`, models see only matches with kickoff `< t`.
2. Walk-forward: train 2 seasons, test 1, slide. Never fit on the test window.
3. De-vig **closing** odds (Pinnacle PSCH if present, else AvgC, else B365C). Opening odds are diagnostic only.
4. A pick exists only if `p_model - p_close >= threshold`. Test 3pp, 5pp, 8pp. No threshold = no edge study.
5. Forbidden: result leak, odds after KO, train+test on the same set, using PredictCamp ensemble as ground truth.
6. Do not hunt 1X2 on PL / LaLiga / Serie A / Bundesliga / UCL as the primary target. Prefer thin leagues and Over 2.5 / BTTS / AH.

## Data

| Source | Use |
|---|---|
| https://www.football-data.co.uk/data.php CSV | Results + closing 1X2 + OU2.5 |
| Repo models `poisson` `dixonColes` `elo` `monteCarlo` | Features / p_model, refit per window |
| PredictCamp MCP (`get_match_models`, `granular_stats`, `ml_1x2`, `context`) | Live features only, never labels |
| Skills `betting`, `football-data`, `bets` | De-vig, Kelly, fixtures |

If a slice has no closing column → **invalid backtest**. Stop and ingest data.

## Metrics (report all)

For every slice:

- `n` (OOS bets after threshold)
- hit rate (secondary)
- ROI @ 1u
- mean CLV vs close (primary)
- log-loss vs implied close vs model
- bootstrap 95% CI on ROI

**PASS (promote to allowlist):** `CLV > 0` AND `ROI > 0` AND `n >= 200` on OOS.
Otherwise **FAIL / SKIP**. "Almost" is FAIL.

## Workflow

1. Read `BACKTEST.md`, `src/models/ensemble.js`, `src/betting`.
2. Ingest CSV for at least 5 thick leagues + 2 thin (RO/AT/CH/DK/CZ if available).
3. Walk-forward refit Dixon-Coles + Elo per window; emit `p_1x2` and `p_over25`.
4. Build slice table: league × market × min_edge. Mark PASS/FAIL with numbers.
5. Explain 3 FAILs (why below market).
6. If 0 PASS: do **not** change production weights. Propose next data (xG, lineup, corners) instead of more Poisson.
7. If 1–2 PASS: implement allowlist only (`league + market + min_edge`). Everything else stays no-bet.

## Production allowlist shape

```json
{
  "league": "RO1",
  "market": "over_2_5",
  "min_edge_pp": 5,
  "max_kelly": 0.25,
  "oos_n": 240,
  "oos_clv": 0.012,
  "oos_roi": 0.04,
  "promoted_at": "YYYY-MM-DD"
}
```

Never ship a pick outside this list.

## Anti-patterns

- Tweaking ensemble weights until in-sample ROI looks good
- Using bot_agreement_pct or STRONG 100% as edge
- Parlays as a way to "fix" weak singles
- Gambler’s fallacy after losing streaks

## Output format

Return a table first, prose second:

| slice | n | CLV | ROI | logloss_model | logloss_close | verdict |
|---|---|---|---|---|---|---|

Then: allowlist JSON or explicit "no promote".

## Double Chance & Parlays (măsurat 2026-09-21)

Walk-forward pe 9.193 de pick-uri, 6 ligi, 5 sezoane, cote reale de închidere.
Vezi `RESEARCH.md` pentru metodologie.

### Dublă șansă

| Strategie | n | Reușită | Cotă | ROI | IC 95% |
|---|---|---|---|---|---|
| 1X2 simplu | 9193 | 51.5% | 2.08 | −2.0% | [−4.1, +0.1] |
| dublă șansă pe pick | 9158 | 77.0% | 1.30 | −1.9% | [−3.0, −0.7] |
| dublă șansă, încredere ≥60% | 2289 | 88.5% | 1.12 | −1.4% | [−2.9, +0.1] |

**Nu e profitabil.** E doar mai puțin volatil decât 1X2. Cota se replică exact
din piața 1X2 prin `1/(1/o_a + 1/o_b)`, deci nu există edge de preț — prin
construcție.

Observație: la 1X2, ROI-ul se înrăutățește cu încrederea (−2.0% → −3.2% →
−4.4%). Piața prețuiește favoriții corect; modelul adaugă zgomot.

### Parlays (3-4 picioare)

**Marja se compune, nu se diluează.** ROI-ul real urmează `(1+r)^n − 1`:

| Picioare | Rată (din 90.9%/picior) | ROI real | ROI teoretic |
|---|---|---|---|
| 1 | 90.9% | −3.0% | −3.0% |
| 2 | 82.1% | −6.2% | −5.9% |
| 3 | 74.0% | −9.9% | −8.7% |
| 4 | 66.5% | −13.5% | −11.4% |

Un bilet combinat nu dă semnal mai bun. Dă același semnal, cu mai mult risc și
marjă plătită de mai multe ori.

### Mișcarea liniei

| Strategie | n | ROI | IC 95% |
|---|---|---|---|
| urmează steam-ul | 9192 | −2.8% | [−5.8, +0.1] |
| fade steam-ul | 9192 | −6.3% | [−9.5, −2.9] |
| steam, mișcare ≥3pp | 2386 | −0.7% | [−5.8, +4.5] |

Semnal real (a urma banii bate a-i contrazice cu 3.5pp), dar **inutilizabil**:
ca să știi unde s-a mutat linia trebuie să aștepți închiderea, moment în care
prețul a absorbit deja mișcarea.

## Reguli noi

1. **Dubla șansă** e permisă doar ca *fallback* pentru încredere ≥60%, niciodată
   ca strategie principală. Implicit oprită (`ALLOW_DOUBLE_CHANCE_FALLBACK`).
2. **Parlays 3-4 picioare: interzise în producție.** Nu construi acumulatoare
   „ca să crești valoarea" — scad ROI-ul monoton.
3. **Mișcarea liniei: doar diagnostic**, nu generator de pick-uri.
4. Un ROI de −1.4% **nu e „aproape profit"**. Nu crește miza pe baza lui.

## Stacking și xG (măsurat 2026-09-21)

- **Stacking** (meta-learner peste modele): +0.22% față de blend fix, −0.31%
  față de piață pe 8.082 de meciuri. Modelele sunt prea corelate — nu reface
  asta cu XGBoost sau rețele neuronale așteptând alt rezultat.
- **xG** (FPL, Premier League): ajută modelul (+0.5 puncte fără piață), dar nu
  adaugă nimic peste piață (−0.28%). Piața prețuiește deja xG-ul.

## Regulă

Nu mai adăuga surse de date publice sau arhitecturi de model așteptând edge.
Tot ce e public e deja în preț. Un slice nou merită testat doar dacă aduce
**informație pe care piața n-o are la momentul pariului** — nu un model mai bun
peste aceeași informație.

## Named-book gap — singura direcție pozitivă (măsurat 2026-09-21)

Sursa: [docs/adaptare-lnmomo-gambling.md](../../../docs/adaptare-lnmomo-gambling.md).

Nu model vs piață, ci **o casă anume vs linia Pinnacle de-vigată**, fără model.
34.481 de meciuri, 19 ligi:

- Max pieței, EV ≥0–4% față de Pinnacle: **ROI +2.4% … +5.0%, p05 > 0, PASS**
  pe 9–40 mii de pariuri. Neexecutabil ca atare (cont la toate casele, cote
  eronate, limitare de cont).
- Bet365 singur: ROI pozitiv în 7 din 8 rânduri, dar p05 < 0. FAIL, semn consistent.

**Acesta e următorul loc unde merită săpat**, nu încă un model. Direcția
practică: scanner de cote în timp real pe casele românești, față de Pinnacle.

## Reguli noi de robustețe

- Bootstrap **pe blocuri de zi**, nu pe pariu (`src/lib/robustness.js`).
  Pariurile din aceeași zi sunt corelate.
- Respinge dacă top-5 câștiguri depășesc 50% din profit.
- Test sign-flip pe profitul zilnic, p ≤ 0.05.
- **CLV-ul se raportează doar când decizia s-a luat înainte de referință.**
  Altfel e identic cu EV-ul de filtrare. Capcana a apărut de două ori.
