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

---

# Personalitățile — 912 meciuri

Fiecare personalitate trece prin același cod de selecție ca în producție
(`buildCandidates` + `selectPick`), pe aceleași meciuri, doar 1X2.

| Bot | Pick-uri | No-bet | Rată | IC 95% | ROI flat | ROI Kelly |
|---|---|---|---|---|---|---|
| statisticianul | 14 | 898 | 71.4% | 45–88% | **+23.0%** | +29.6% |
| forma-zilei | 124 | 788 | 52.4% | 44–61% | −4.3% | −9.4% |
| matematicianul | 231 | 681 | 50.6% | 44–57% | −9.2% | −11.2% |
| istoricul | 49 | 863 | 51.0% | 37–64% | −9.9% | −7.2% |
| ai-analyst | 72 | 840 | 48.6% | 37–60% | −10.3% | −9.7% |
| underdog-lover | 505 | 407 | 16.2% | 13–20% | −12.8% | −18.3% |
| value-hunter | 475 | 437 | 23.2% | 20–27% | −15.4% | −14.2% |

**`statisticianul` e singurul cu ROI pozitiv — dar n=14.** Intervalul de
încredere pe rata de reușită e 45–88%. La 14 pariuri din 912 meciuri nu se
poate afirma nimic despre profitabilitate; e extrem de selectiv (încredere ≥58%,
edge ≥4%, fără egal) și ar putea fi pur noroc. Merită urmărit, nu adoptat.

**`value-hunter` are cel mai prost ROI — și asta e coerent.** El ordonează
pick-urile după `edge`, iar backtestul de model a arătat că edge-ul e eroare de
model, nu preț greșit. Maximizând edge-ul, maximizează eroarea. E cea mai
curată confirmare că `edge_pct` nu e acționabil.

RPS-ul e practic identic între boți (0.2031–0.2048): probabilitățile de bază
sunt aceleași, diferă doar politica de selecție.

---

# Ponderile ensemble — nu contează

Căutare pe 4000 de combinații, antrenare pe PL/PD/SA (598 meciuri), test pe
BL1/FL1 (314) — ligi pe care optimizarea nu le-a văzut.

| Variantă | Ponderi | RPS train | RPS test |
|---|---|---|---|
| optim pe train | DC .06 / MC .48 / Po .17 / Elo .29 | 0.20700 | 0.19539 |
| actual (ai-analyst) | DC .35 / MC .00 / Po .15 / Elo .25 | 0.20716 | 0.19543 |
| uniform | .25 fiecare | 0.20709 | 0.19539 |
| doar Dixon-Coles | — | 0.20889 | 0.19639 |
| doar Monte Carlo | — | 0.20873 | 0.19684 |
| doar Elo | — | 0.20995 | 0.20090 |
| doar Poisson | — | 0.21232 | 0.20206 |

**Câștig pe test: 0.02%.** Îmbunătățirea nu se generalizează.

Dar există un rezultat real: **orice combinație bate orice sursă singură.**
Blendingul aduce 1–3%; ponderile exacte nu aduc nimic. Nu le-am schimbat —
ar fi fost precizie falsă.

---

# Piețele alternative (granular) — aproape zgomot

Endpoint-ul real se calculează *acum*, deci pentru un meci vechi ar include
meciuri de după el. `historicalGranular` reconstruiește semnalul din meciuri
strict anterioare, păstrând forma consumată de `granularMarkets()`.

864 de semnale, prag de abatere 10pp:

| Selecție indicată | n | Confirmat | Reper (fără semnal) | Efect |
|---|---|---|---|---|
| Over 2.5 | 169 | 54.4% | 53.0% | +1.4pp |
| Under 2.5 | 149 | 49.0% | 47.0% | +2.0pp |
| BTTS Yes | 164 | 59.8% | 54.2% | +5.6pp |
| **BTTS No** | 146 | **43.2%** | 45.8% | **−2.6pp** |

Mărimea abaterii aproape nu contează: 50.6% la 10–15pp, 52.4% la 15–20pp,
55.3% la 20–30pp — cu intervale care se suprapun toate.

**Concluzia: semnalul granular nu prezice.** `BTTS No` e chiar
contraproductiv. Singurul cu semn pozitiv real e `BTTS Yes`.

Am păstrat flag-urile ca filtru conservator — cer confirmare înainte de un
pariu pe piață alternativă — dar mesajele spun acum explicit că e indiciu, nu
verdict. Nu le-am transformat în `exclude`: n-ar fi justificat de date.

---

## Ce rămâne nevalidat

- **Clasificarea fallback-ului PredictCamp.** `/models` dă 422 după meci, deci
  flag-urile reale (`homeIsFallback`, `LAMBDA_CAPPED`) nu se pot reconstrui.
  În replay sunt aproximate prin eșantionul propriu.
- **Conjuncția** „pick de model + confirmare granular" — validat semnalul
  granular singur, nu combinația.
- **`statisticianul`** — ROI pozitiv la n=14. Are nevoie de mai multe sezoane.
- **Piețele de cornere și cartonașe** — nu sunt în replay deloc.

## Reproducere

```bash
node scripts/backtest.js --refit --league=SA \
  --from=2025-08-01 --to=2026-06-30 --limit=200 --market
```

`--from`/`--to` sunt obligatorii: fără ele, `/matches` aplică o fereastră
implicită îngustă și întoarce o mână de meciuri.
