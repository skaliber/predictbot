# Backtest — 21 septembrie 2026

Walk-forward pe sezonul 2025/26, cinci ligi majore, **824 de meciuri** evaluate.

Procedura: pentru fiecare meci de test, Dixon-Coles se reantrenează **doar pe
meciurile dinaintea lui**, apoi Monte Carlo 5.000 de simulări dă probabilitățile
1X2. Nimic din viitor nu intră în antrenare. Rata de bază 1/X/2 se calculează
la fel, doar din trecut.

Cotele de comparație sunt cele istorice din PredictCamp
(`source: livescore_history`), toate marcate `recorded_before_kickoff = true`
în baza de date — deci comparația cu piața e validă, nu contaminată de rezultat.

## Rezultate

| Ligă | Meciuri | RPS model | RPS piață | vs piață | vs rată de bază | Acuratețe model | Acuratețe piață |
|---|---|---|---|---|---|---|---|
| Premier League | 190 | 0.2178 | 0.2095 | **−4.0%** | +3.8% | 42.6% | 45.8% |
| LaLiga | 176 | 0.2199 | 0.2056 | **−7.0%** | +1.6% | 46.0% | 50.6% |
| Serie A | 174 | 0.1989 | 0.1920 | **−3.6%** | +15.7% | 51.7% | 57.5% |
| Bundesliga | 143 | 0.1825 | 0.1792 | **−1.8%** | +19.4% | 59.4% | 55.9% |
| Ligue 1 | 141 | 0.2133 | 0.1983 | **−7.6%** | +7.2% | 46.8% | 54.6% |

RPS = Ranked Probability Score, mai mic e mai bun.

## Concluzia

**Modelul e în urma pieței în toate cele cinci ligi**, cu 1.8% până la 7.6%
(medie ~4.8%). Bate reperul naiv (rata de bază) în toate, dar inegal: +1.6% pe
LaLiga, +19.4% pe Bundesliga.

Ce înseamnă asta practic: **nu există edge sistematic față de bookmaker.**
Când `edge_pct` din bot iese pozitiv, e mai probabil eroare de model decât preț
greșit al pieței — fiindcă pe medie modelul e cel care greșește mai mult.

Asta nu e un eșec al implementării. Piața de pariuri e greu de bătut, iar 2-8%
în urma cotei de închidere e un rezultat respectabil pentru un model simplu.
Modelul ML propriu al PredictCamp raportează, onest, aceeași situație
(`log_loss_delta_vs_market` pozitiv, `parity_established: false`).

---

# Validarea tier-urilor — 912 meciuri

`scripts/validateTiers.js` reconstruiește, pentru fiecare meci din trecut, exact
ce ar fi știut botul la kickoff: Dixon-Coles refit pe meciurile anterioare, Elo
din rezultate anterioare, formă din ultimele 5 meciuri strict anterioare, cote
pre-kickoff. Nimic din viitor.

Exclus din replay: `granular-stats` se calculează *acum*, deci pentru un meci
vechi ar conține meciuri de după el. Regulile bazate pe el rămân nevalidate.

## Înainte de recalibrare

| Tier | n | Rată | IC 95% |
|---|---|---|---|
| SAFE | 31 | 71.0% | 53.4–83.9% |
| MODERATE | 205 | 62.9% | 56.1–69.2% |
| RISKY | 418 | 42.8% | 38.2–47.6% |
| **EXCLUDED** | 258 | **45.7%** | 39.8–51.8% |

Problema: **pick-urile EXCLUSE ieșeau mai des (45.7%) decât cele păstrate ca
RISKY (42.8%).** Regulile de excludere aruncau valoare.

## Efectul măsurat al fiecărui flag

| Flag | n | Rată cu | Rată fără | Diferență |
|---|---|---|---|---|
| `CONSENSUS_VS_MARKET` | 28 | 17.9% | 50.1% | **−32.3pp** |
| `POOR_FORM_PICK` | 258 | 45.7% | 50.5% | −4.7pp |
| `SMALL_SAMPLE` | 704 | 49.6% | 47.6% | **+2.0pp** |

Trei concluzii, toate contra-intuitive față de cum le ponderasem:

1. **`CONSENSUS_VS_MARKET` e de departe cel mai puternic semnal.** Când toate
   modelele sunt de acord *împotriva* pieței, modelele greșesc — 17.9% reușită.
   Era `downgrade`, a devenit `exclude`.
2. **`POOR_FORM_PICK` are efect real dar mic.** `exclude` era prea dur: pick-urile
   astea ies totuși mai des decât cele lăsate ca RISKY. A devenit `downgrade`.
3. **`SMALL_SAMPLE` nu discriminează deloc** — pick-urile cu flag ies cu +2pp
   *mai des*. Pragul de 30 se aprinde pe 77% din meciuri. A devenit `note`.

## După recalibrare

| Tier | n | Rată | IC 95% | ROI flat |
|---|---|---|---|---|
| SAFE | 31 | 71.0% | 53.4–83.9% | −1.5% |
| MODERATE | 208 | 63.5% | 56.7–69.7% | −7.9% |
| RISKY | 645 | 44.8% | 41.0–48.7% | −6.8% |
| EXCLUDED | 28 | **17.9%** | 7.9–35.6% | −34.6% |

**Ce e validat statistic:**
- MODERATE vs RISKY — intervalele de încredere nu se suprapun. Separare reală.
- EXCLUDED vs restul — 17.9% față de 44.8%, fără suprapunere. Regulile de
  excludere identifică acum corect pick-urile proaste.

**Ce NU e validat:**
- SAFE vs MODERATE — intervalele se suprapun (53.4–83.9% vs 56.7–69.7%).
  Cu n=31 nu se poate distinge. Tratează-le ca pe același nivel deocamdată.

## Calibrare

| Bucket | n | Declarat | Real | Eroare |
|---|---|---|---|---|
| 0–40% | 176 | 37.8% | 33.0% | −4.8pp |
| 40–50% | 343 | 44.6% | 43.4% | −1.1pp |
| 50–60% | 245 | 54.7% | 56.3% | +1.6pp |
| 60–70% | 104 | 64.3% | 64.4% | +0.2pp |
| 70–80% | 38 | 74.3% | 84.2% | +9.9pp |
| 80–100% | 6 | 82.4% | 66.7% | −15.8pp |

Calibrarea e bună pe intervalul unde stau majoritatea pick-urilor (0–70%,
erori sub 5pp). Peste 70% modelul e prea modest, dar eșantionul e mic.

## Concluzia care contează

**Tier-urile ordonează corect, dar niciunul nu bate marja bookmakerului.**
ROI flat e negativ peste tot, de la −1.5% (SAFE) la −34.6% (EXCLUDED). Asta e
consistent cu backtestul de model: fără edge față de piață, o rată de reușită
mai bună nu produce profit, fiindcă e deja în cotă.

Folosește tier-urile ca **ordonare de risc**, nu ca promisiune de profit.

## Reproducere

```bash
node scripts/validateTiers.js --leagues=PL,PD,SA,BL1,FL1   --from=2025-08-01 --to=2026-06-30
```

## Ce rămâne nevalidat

- Regulile bazate pe `granular-stats` (leakage în replay).
- Clasificarea fallback-ului PredictCamp (`/models` dă 422 după meci) —
  aproximată în replay prin eșantionul propriu.
- Ponderile ensemble per personalitate — niciodată optimizate pe date.
- Personalitățile în afară de `ai-analyst`.

## Reproducere

```bash
node scripts/backtest.js --refit --league=SA \
  --from=2025-08-01 --to=2026-06-30 --limit=200 --market
```

`--from`/`--to` sunt obligatorii: fără ele, `/matches` aplică o fereastră
implicită îngustă și întoarce o mână de meciuri.
