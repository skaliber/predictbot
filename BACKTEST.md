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

## Ce NU e validat încă

- **Pragurile SAFE / MODERATE / RISKY.** Le-am ales din practică plus convenție.
  Nimeni n-a verificat că pick-urile `SAFE` ies mai des decât cele `MODERATE`.
  Are nevoie de ~200 de pariuri soluționate, împărțite pe tier.
- **Regulile de screening** (veto de formă, clasificarea fallback-ului). Sunt
  testate că se *aplică* corect, nu că *prezic* corect.
- **Ponderile ensemble-ului per personalitate** — niciodată optimizate pe date.

## Reproducere

```bash
node scripts/backtest.js --refit --league=SA \
  --from=2025-08-01 --to=2026-06-30 --limit=200 --market
```

`--from`/`--to` sunt obligatorii: fără ele, `/matches` aplică o fereastră
implicită îngustă și întoarce o mână de meciuri.
