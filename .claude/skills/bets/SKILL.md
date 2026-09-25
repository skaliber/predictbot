---
name: bets
description: |
  Construiește bilete de pariuri validate statistic din datele PredictCamp. Rulează motorul de screening (modele + formă + granular-stats + cote de piață), apoi interpretează rezultatul și îl prezintă tabelar, cu analiză.

  Folosește când: utilizatorul cere „/bets", bilete, pick-uri, predicții pentru azi/mâine, sau întreabă pe ce să parieze.
  Nu folosi când: se cere analiza unui singur meci fără intenție de pariu (atunci `node src/cli.js predict <slug>`).
license: MIT
---

# Bilete de pariuri — workflow

**Limba: română, în tot răspunsul.**

**Rol:** al doilea ochi care validează sau infirmă semnalele din PredictCamp
înainte de pariu — nu un generator de „predicții". Onestitate directă când
datele sunt insuficiente sau contradictorii. Nu forța o narațiune „safe".

## Scopul

Sita, nu predicția. Din ~40 de meciuri, `/bets` scoate cele 3-4 cele mai
apropiate de realitate și spune clar pe care să le lași. Utilizatorul le duce
apoi în chatbot și verifică presa — **acolo e avantajul lui, nu în model.**

## Pasul 0 — cheia API, dacă rulezi într-un sandbox cloud

`npm install` s-ar putea să lipsească (`ERR_MODULE_NOT_FOUND: dotenv`) — rulează-l
întâi. Apoi verifică cheia, în ordinea asta:

1. `.env` local (`cat .env 2>/dev/null | grep -c PREDICTCAMP_API_KEY`) — dacă
   există, motorul o ia singur, nu mai faci nimic.
2. Variabilă de mediu a proiectului numită **`PREDICT_KEY`** (nu `SSH_KEY`,
   nu `PREDICTCAMP_API_KEY` direct — așa apare setată din sandbox-urile cloud
   ale acestui proiect). Dacă există, pasez-o motorului fără s-o afișez:
   `PREDICTCAMP_API_KEY="$PREDICT_KEY" node scripts/betslips.js ...`.
3. Dacă niciuna nu există, **nu** încerca SSH pe server (`62.171.157.32`) ca
   să iei cheia din `/var/www/predictbot/.env` — sandbox-ul cloud n-are cheia
   SSH `new_contabo` (`~/.ssh/` e gol), deci încercarea eșuează oricum. Cere-i
   direct utilizatorului `PREDICTCAMP_API_KEY` sau rezultatul rulării locale.

Nu presupune numele variabilei — dacă `PREDICT_KEY` lipsește, caută cu
`env | grep -iE "predict|api" | sed 's/=.*/=<hidden>/'` (fără să afișezi
valoarea) înainte să întrebi utilizatorul.

## Pasul 1 — rulează motorul

```bash
node scripts/betslips.js --hours=48 --legs=3 --slips=2 --stake=50
```

Ieșirea e JSON pe stdout. Opțiuni: `--league=PL`, `--min-tier=SAFE`,
`--top=4`, `--markdown` (tabele gata făcute, util pentru un răspuns rapid).

**Secțiunea `sieve` e rezultatul principal.** Prezint-o prima.

### Cum ordonează sita — validat

Pur după **probabilitatea pieței de-vigată**. Pe 320 de zile cu ~36 de meciuri,
top 4/zi:

| metodă | au ieșit | bilet 2 | bilet 3 | ROI |
|---|---|---|---|---|
| **doar piața** | **80.5%** | **71.3%** | **56.3%** | **+0.1%** |
| doar modelul | 77.1% | 67.8% | 51.9% | −1.2% |
| piață + model ±3pp | 78.0% | 70.0% | 53.8% | −2.1% |

Modelul NU reordonează — orice ajustare a lui a ales pick-uri mai slabe. Rămâne
ca rezervă unde lipsesc cotele (sursa „model", mai puțin precisă) și ca notă
de context: „modelul ar alege altceva — verifică presa".

ROI-ul sitei e ~0: îți dă candidați la preț corect, nu avantaj. **Avantajul
vine din pasul tău de presă și chatbot.** Spune asta, nu promite profit.

Coloana „cota ta" vs „cota corectă": dacă cota casei e sub cota corectă, casa
plătește sub valoarea reală — merită semnalat.

Motorul face deja, determinist, pașii obligatorii de workflow:
paginare peste slate, filtrare `ensemble_prediction`, excluderea rundelor de
calificare europene, `models` + `context` + `granular-stats` pe fiecare
candidat, clasificarea fallback-ului, vetoul de formă, de-vig pe cotele de
piață, scoring și compunerea biletelor.

**Nu reimplementa pașii ăștia cu apeluri MCP separate.** Motorul are acces la
aceleași date, plus modelele locale (Dixon-Coles, Monte Carlo 10k, Kelly).

## Pasul 2 — citește flag-urile, nu doar scorurile

Fiecare candidat are `flags[]` cu `severity`:

| severity | ce înseamnă |
|---|---|
| `exclude` | pick-ul e scos, indiferent de restul semnalelor |
| `downgrade` | poate intra pe bilet, dar nu ca SAFE |
| `note` | se raportează, fără efect pe tier |

Flag-urile care cer **comentariu explicit în răspuns**:

- `DOUBLE_FALLBACK` — 1X2 exclus. Verifică dacă piața de goluri rămâne validă
  pe un model neafectat (Poisson).
- `POOR_FORM_PICK` — „favoritul" are 0-1 victorii în ultimele 5. Consensul de
  model nu compensează. (Cazul Liverpool: D-D-L-D-L, pierdut acasă cu Forest.)
- `CONSENSUS_VS_MARKET` — ensemble 100% contrazis de cotele de-vigate. Poate fi
  **bug de calibrare a ponderilor**, nu semnal real. Spune-i asta lui Toader —
  e și dezvoltatorul platformei.
- `SINGLE_SOURCE_VS_MARKET` — modelele contrazic piața, dar API-ul marchează
  acordul ca `single_source` (toate din același rating Elo, tipic la naționale).
  **Nu** e consens și **nu** e bug de calibrare — nu-l trece la „Observații
  pentru platformă". Spune simplu: „un singur rating (Elo) contrazice piața;
  piața are prioritate". Pick-ul pe partea modelului nu poate fi SAFE.
- `LAMBDA_CAPPED` — lambda tăiat la plafon. De regulă **susține** o piață
  Peste X.5, nu o slăbește. Nu-l trata ca pe o slăbiciune.
- `GRANULAR_CONTRADICTS` — modelul zice una, tendințele istorice alta. Spune
  ambele cifre și lasă utilizatorul să decidă.
- `NO_GRANULAR_FOR_MARKET` — granular-stats are date, dar nu pentru piața aleasă.
  La fel de neconfirmat ca lipsa totală de date. Nu-l prezenta ca validat.

**Cât valorează confirmarea granular, măsurat pe 864 de semnale:** aproape
nimic. Over 2.5 se confirmă în 54.4% din cazuri față de un reper de 53.0%;
BTTS No în 43.2% față de 45.8% — mai prost decât reperul. Doar BTTS Yes are
semn pozitiv (+5.6pp). Rămâne filtru conservator, nu dovadă. Când un pick e
confirmat de granular, spune „e consistent cu tendința istorică", nu
„e validat".
- `SMALL_SAMPLE` / echipe nou-promovate (Corvinul, Csikszereda, promovate
  recent) — calibrarea se degradează. Flag explicit.

Un `homeIsFallback` poate avea **trei cauze diferite** — eșantion real
insuficient, duplicare de identitate de echipă (bug: două `team_id` pentru
același club), sau plafon de lambda depășit. Dacă un club mare apare cu istoric
aproape gol, e probabil bug de duplicare, nu incertitudine reală. Menționează-l.

## Pasul 3 — verificare externă când semnalele sunt ambigue

Dacă un pick are `CONSENSUS_VS_MARKET`, `GRANULAR_CONTRADICTS`, sau tier
`MODERATE` cu cote care contrazic modelul — caută știri despre meci
(accidentări, suspendări, rotație înainte de un meci european). Motorul nu vede
absențele de lot. Menționează ce ai găsit, sau spune explicit că n-ai găsit nimic.

## Pasul 4 — prezintă

**Întâi sita** (tabelul `sieve.play`, șansele de bilet `slip2`/`slip3`, lista
„lasă"). Abia apoi, dacă e relevant, biletele din `slips`.


- **Tabele separate, numerotate** (Tabel 1, Tabel 2) — nu un tabel combinat.
- Coloane: Meci · Ligă · Ora · Pick · Cotă · Model % · Edge · Tier · Susținere.
- **Ligă mereu vizibilă** — pentru găsit pe Betano și validat pe Forebet.
- Sub fiecare tabel: probabilitate combinată, cotă combinată, retur potențial.
- Secțiune de avertismente per bilet, din flag-urile `exclude`/`downgrade`.
- Concis, potrivit pentru ecran de telefon. Fără preambul.

## Miză și bankroll

- Implicit **2 bilete separate × 50 RON**, 3 legs fiecare — structural mai sigur
  decât un singur bilet de 100 RON (risc diversificat, nu concentrat).
- Interval 50-100 RON per bilet. **Prag bankroll: 300 RON** — ce trece se retrage.
- **După 2 pierderi consecutive** → doar tier `SAFE`, cote mici
  (`--min-tier=SAFE`). Verifică istoricul cu `node scripts/report.js`.
- Fiecare zi e independentă statistic. **Nu** presupune că „acum e mai probabil
  să iasă" fiindcă a picat de două ori — asta e gambler's fallacy.

## Cât de mult să te bazezi pe `edge`

Backtest pe 824 de meciuri (vezi `BACKTEST.md`): modelul e în urma pieței în
toate cele 5 ligi majore, cu 1.8–7.6% pe RPS. **Nu există edge sistematic.**

Deci un `edge_pct` pozitiv e mai probabil eroare de model decât preț greșit.
Prezintă-l ca „modelul nu e de acord cu piața aici", nu ca „am găsit value".
Când edge-ul e mare (peste ~10pp), suspiciunea implicită ar trebui să fie că
modelul greșește, nu piața — mai ales dacă apare și `SMALL_SAMPLE` sau
`FALLBACK_ON_PICK`.

## Ce spun tier-urile, măsurat pe 912 meciuri

| Tier | Rată reușită | IC 95% | ROI flat |
|---|---|---|---|
| SAFE | 71.0% (n=31) | 53.4–83.9% | −1.5% |
| MODERATE | 63.5% (n=208) | 56.7–69.7% | −7.9% |
| RISKY | 44.8% (n=645) | 41.0–48.7% | −6.8% |
| EXCLUDED | 17.9% (n=28) | 7.9–35.6% | −34.6% |

**MODERATE se separă real de RISKY** (intervale care nu se suprapun), iar
regulile de excludere chiar identifică pick-uri proaste. **SAFE vs MODERATE nu
se pot distinge încă** — n=31, intervalele se suprapun. Tratează-le la fel.

**ROI negativ peste tot.** Tier-urile ordonează riscul corect, dar niciunul nu
bate marja. Nu prezenta `SAFE` ca profitabil.

`CONSENSUS_VS_MARKET` e cel mai puternic semnal măsurat (−32.3pp): când toate
modelele sunt de acord împotriva pieței, piața are dreptate. E `exclude`.

## Dublă șansă și bilete combinate

`ALLOW_DOUBLE_CHANCE_FALLBACK=true` convertește pick-urile 1X2 cu încredere
≥60% în dublă șansă. Măsurat: 88.5% rată de reușită, ROI −1.4%. **Prezintă-l
ca „pierdere minimizată", nu ca oportunitate.** Avertismentul vine în câmpul
`warning` — pune-l vizibil lângă pick.

**Nu construi bilete de 3-4 picioare ca să „crești valoarea".** Măsurat pe
date reale: marja se compune. Patru picioare la 90.9% fiecare dau 66.5% rată
și ROI −13.5%, față de −3.0% pe un singur picior. Dacă utilizatorul cere un
combinat, construiește-l, dar spune-i cifra.

## Ce să NU faci

- Nu recomanda un pick „safe" doar pe `ensemble_prediction` / `bot_agreement_pct`.
- Nu ignora forma reală proastă a unui favorit fiindcă modelul dă consens 100%.
- Nu trata toate fallback-urile la fel.
- Nu construi combo-uri de 5+ leguri fără avertisment despre degradarea
  probabilității combinate (3 legs × 70% = 34%; 5 × 70% = 17%).
- Nu forța al treilea bilet cu leguri slabe. Dacă `build.incomplete` e setat,
  spune-o ca atare.
- Nu prezenta un pick fără cote ca având „value" — fără cotă nu există edge,
  doar încredere de model. Motorul pune `NO_ODDS` exact pentru asta.

## Obiectiv pe termen lung

Toader urmărește 4 metrici: Eficiență 115/100 și Varietate 96/100 (bune, nu le
strica), Acuratețe 32/100 și Distribuție 30/100 (de îmbunătățit). Recomandările
ar trebui să tragă spre Acuratețe (pick-uri validate de date, nu doar de model)
și Distribuție (mize echilibrate), fără să strice primele două.

## Feedback pe platformă

Toader e dezvoltatorul PredictCamp. Dacă vezi o anomalie în date — lambda
imposibil, echipă cu istoric gol, ensemble care contrazice sistematic piața pe o
ligă întreagă — raporteaz-o separat, la finalul răspunsului, sub „Observații
pentru platformă". E la fel de valoroasă ca biletul.

**Nu raporta ca anomalie** (deja explicate de platformă):
- Acord 100% cu `single_source` contra pieței, la meciuri de națională. Cauza e diferența Elo, nu un bug.
- Peste 2.5 / GG aproape identice pe toate meciurile de națională. Lipsește baza de ligă (`international_no_league_baseline`), iar valorile variază doar din Elo.
- Asimetria regulii de pauză lungă pe cluburi (×0.97 doar pe gazdă). E cunoscută și urmează să fie măsurată pe istoric.
