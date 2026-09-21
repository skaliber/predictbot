# Cercetare — ineficiența pieței, 21 septembrie 2026

Modelul s-a dovedit redundant față de piață. Întrebarea a devenit: **există
segmente unde piața însăși greșește?** Aici nu intervine niciun model — doar
cote și rezultate, deci eșantionul e tot ce există în bază.

**32.171 de meciuri, 22 de ligi, 2021–2026.** 38 de strategii testate.

Fiecare rezultat are eroare standard și `t` (de câte erori standard e departe
de zero). Sub |t| = 2, nu se poate afirma nimic.

## Rezultatul principal

**Nicio strategie nu iese pe plus.** Niciuna din cele 38 nu are ROI pozitiv
semnificativ. Toate cele care trec pragul statistic sunt **negative**.

Dar mărimea pierderii variază enorm, și asta e acționabil.

## H1 — Favourite-longshot bias: confirmat

| Cotă | n | ROI | t |
|---|---|---|---|
| 1.00–1.50 | 5.649 | **−1.19%** | −1.58 |
| 1.50–2.00 | 12.000 | −3.56% | −4.52 |
| 2.00–3.00 | 20.585 | −5.40% | −6.53 |
| 3.00–5.00 | 44.606 | −7.69% | −10.21 |
| 5.00–10.0 | 11.369 | −16.32% | −8.16 |
| 10.0+ | 2.304 | **−35.81%** | −5.93 |

Gradient perfect monoton. Cu cât cota e mai mare, cu atât pierzi mai mult.
La cote peste 10, pierzi o treime din fiecare leu. **Sub 1.50, pierderea e
indistinctă de zero** (t = −1.58).

## H2 — Poziția

| Pariu | n | ROI | t |
|---|---|---|---|
| gazde (1) | 32.171 | −6.38% | −9.23 |
| egal (X) | 32.171 | −6.43% | −6.91 |
| **oaspeți (2)** | 32.171 | **−11.19%** | −12.35 |

Pariurile pe oaspeți sunt net mai proaste. Piața supraevaluează sistematic
echipele din deplasare.

## H3 — Marja bookmakerului

| Marjă | n | ROI |
|---|---|---|
| sub 4% | 7.842 | −5.99% |
| 4–6% | 39.627 | −6.58% |
| 6–8% | 33.843 | −8.28% |
| 8–12% | 14.778 | −12.01% |
| peste 12% | 423 | −15.84% |

Gradient clar. Marja e un cost direct — **același pariu, la un bookmaker cu
marjă mai mică, pierde cu 6 puncte mai puțin.**

## H4 — Faza sezonului

Variație mică: −8.66% la început (iul–sep), −6.65% la final (apr–iun). Ipoteza
că piața e mai slabă la începutul sezonului, când are puține date, **nu se
confirmă** — diferența e sub eroarea de măsurare pe segmente.

## H5 — Pe ligă, pariind favoritul

Cele mai proaste (toate cu |t| > 2):

| Ligă | n | ROI | t |
|---|---|---|---|
| Ekstraklasa | 1.401 | −11.81% | −4.43 |
| MLS | 2.298 | −8.91% | −4.39 |
| Austrian Bundesliga | 879 | −8.08% | −2.47 |
| **Liga I** | 1.433 | **−8.00%** | −3.09 |
| Eredivisie | 1.407 | −7.71% | −3.25 |
| Championship | 2.655 | −6.99% | −3.53 |

Ligile de top (LaLiga, Europa League, Super Lig, Champions League) sunt aproape
de zero, dar niciuna nu are |t| > 1 — deci nici ele nu se pot declara
profitabile.

**Liga I e printre cele mai proaste piețe testate** pentru pariul pe favorit.

## H6 — Outsiderul de acasă: mit

| Pariu | n | ROI |
|---|---|---|
| gazde outsider | 9.969 | −11.50% |
| gazde outsider la cotă ≥3.00 | 7.720 | −12.93% |
| oaspeți favoriți | 9.969 | −3.44% |

Înțelepciunea populară „outsiderul de acasă e subevaluat" e **falsă** în datele
noastre. E una dintre cele mai proaste categorii.

## H7 — Egalul în meciuri echilibrate

| Echilibru | n | ROI |
|---|---|---|
| foarte echilibrat | 2.863 | −5.96% |
| echilibrat | 4.277 | −3.40% |
| favorit clar | 9.258 | −3.44% |
| dezechilibru mare | 15.773 | −9.09% |

Egalul nu e subevaluat în meciurile echilibrate. Dimpotrivă: e cel mai prost
exact acolo unde intuiția l-ar recomanda mai puțin — în meciurile dezechilibrate.

## H8 — Combinația semnalelor

H1, H3 și H5 arată în aceeași direcție. Aplicate în cascadă:

| Filtru cumulativ | n | ROI | t |
|---|---|---|---|
| doar favoritul | 32.171 | −3.93% | −7.39 |
| + cotă sub 2.00 | 17.644 | −2.78% | −4.74 |
| **+ cotă sub 1.60** | 7.863 | **−1.25%** | **−1.79** |
| + marjă sub 6% | 3.840 | −1.64% | −1.63 |
| + ligă de top | 2.387 | −1.30% | −1.02 |

**Filtrarea la favoriți sub cota 1.60 reduce pierderea de la ~8% la ~1.25%** —
și la acel punct nu se mai distinge statistic de zero. Filtrele suplimentare nu
mai adaugă nimic măsurabil.

Asta **nu e profit.** E pierdere minimă. Intervalul real e între −2.6% și +0.1%.

## Ce s-a făcut cu rezultatele

`src/bot/marketPrior.js` codifică frecvențele astea, iar `marketRealityCheck`
le aplică peste orice pick, independent de model:

- `BAD_MARKET_SEGMENT` (degradare) — categorie cu așteptare istorică ≤ −10%
- `HIGH_MARGIN` (degradare) — marjă ≥ 8%, cu sugestia de a căuta alt bookmaker
- `BEST_MEASURED_CATEGORY` (notă) — favorit sub 1.60, singura categorie
  aproape de break-even

## Avertisment metodologic

38 de strategii testate. La atâtea teste, câteva trec pragul din întâmplare.
Faptul că **niciuna pozitivă** n-a trecut întărește concluzia — nu există
cherry-picking într-un rezultat negativ. Dar orice ROI pozitiv găsit aici ar fi
fost ipoteză de verificat, nu descoperire.

Cotele sunt cele istorice din PredictCamp (`recorded_before_kickoff = true`),
probabil cote de închidere. Cotele de deschidere ar putea fi mai slabe — asta
rămâne netestat, fiindcă avem un singur instantaneu per meci.

---

# Dublă șansă, bilete combinate și mișcarea liniei

9.193 de pick-uri walk-forward, 6 ligi (E0/E1/I1/SP1/D1/N1), 5 sezoane, cote
reale de închidere. `node scripts/combinedReport.js`.

## Dubla șansă bate 1X2 la orice prag

| Strategie | n | Reușită | Cotă | ROI | IC 95% |
|---|---|---|---|---|---|
| 1X2 simplu | 9193 | 51.5% | 2.08 | −2.0% | [−4.1, +0.1] |
| dublă șansă pe pick | 9158 | 77.0% | 1.30 | −1.9% | [−3.0, −0.7] |
| 1X2, încredere ≥50% | 4461 | 60.7% | 1.67 | −3.2% | [−5.7, −0.8] |
| dublă șansă, încredere ≥50% | 4461 | 84.1% | 1.18 | −1.6% | [−2.8, −0.2] |
| **dublă șansă, încredere ≥60%** | 2289 | **88.5%** | 1.12 | **−1.4%** | [−2.9, +0.1] |
| 1X2, încredere ≥70% | 1006 | 74.4% | 1.31 | −4.4% | [−7.8, −1.0] |

Cel mai bun rezultat din toată cercetarea. Rămâne negativ.

Observația secundară e la fel de importantă: **la 1X2, ROI-ul se înrăutățește
pe măsură ce crește încrederea modelului** (−2.0% → −3.2% → −4.4%). Piața
prețuiește favoriții corect; încrederea modelului adaugă zgomot, nu informație.

## Biletele combinate: marja se compune

| Strategie | Bilete | Ieșite | ROI real | ROI teoretic |
|---|---|---|---|---|
| încredere ≥70% · 1 picior | 1008 | 74.3% | −4.2% | −4.2% |
| încredere ≥70% · 3 picioare | 336 | 39.9% | −13.1% | −12.2% |
| încredere ≥70% · 4 picioare | 252 | 28.2% | −19.0% | −15.9% |
| dublă șansă ≥70% · 1 picior | 1006 | 90.9% | −3.0% | −3.0% |
| dublă șansă ≥70% · 4 picioare | 251 | 66.5% | −13.5% | −11.4% |

Coloana teoretică e `(1+r)^n − 1`, iar realitatea o urmează aproape exact.
Fiecare picior adaugă încă o dată marja bookmakerului.

Chiar și la 90.9% reușită per picior, patru combinate cad la 66.5% și pierderea
se triplează.

## Mișcarea liniei: semnal real, inutilizabil

| Strategie | n | Reușită | ROI | IC 95% |
|---|---|---|---|---|
| urmează steam-ul | 9192 | 39.7% | −2.8% | [−5.8, +0.1] |
| fade steam-ul | 9192 | 33.6% | −6.3% | [−9.5, −2.9] |
| steam, mișcare ≥3pp | 2386 | 43.2% | −0.7% | [−5.8, +4.5] |

A urma banii bate a-i contrazice cu 3.5 puncte, iar efectul crește cu mărimea
mișcării. Dar ca să știi unde s-a mutat linia trebuie să aștepți închiderea,
când prețul a absorbit deja mișcarea. E o confirmare că piața funcționează,
nu o strategie.

„Model și steam de acord" (−2.3%) nu bate „în dezacord" (−1.7%): acordul cu
banii nu îmbunătățește pick-urile modelului.

---

## Reproducere

```bash
node scripts/hypotheses.js --from=2021-08-01 --to=2026-06-30
node scripts/combinedReport.js --main=E0,E1,I1,SP1,D1,N1 --seasons=2021,2122,2223,2324,2425
node scripts/edgeReport.js --main=E0,E1,E2,I1,I2,SP1,SP2,D1,D2,N1 --seasons=2021,2122,2223,2324,2425
```

Prima rulare descarcă datele (~10 min); următoarele folosesc cache-ul local
din `data/cache/`.

---

# Stacking și xG — ultimele două ipoteze

## Stacking (meta-learner)

Abordarea din `soumendu-11/fifa-wc2026-predictor`: regresie logistică
multinomială peste predicțiile modelelor de bază, antrenată walk-forward.
Plus adăugirea care lipsește acolo — prețul pieței ca feature. 8.082 de meciuri
OOS, 6 ligi. `node scripts/stackingReport.js`.

| Variantă | RPS | Log-loss | Acuratețe | vs piață |
|---|---|---|---|---|
| blend fix | 0.20291 | 0.9948 | 51.9% | −3.48% |
| **piață singură** | **0.19608** | **0.9724** | 53.4% | — |
| stacking fără piață | 0.20246 | 0.9937 | 52.0% | −3.26% |
| stacking CU piață | 0.19668 | 0.9753 | 53.3% | −0.31% |
| doar piața ca feature | 0.19624 | 0.9737 | 53.6% | −0.08% |

Meta-learnerul bate blendingul fix cu doar +0.22%: modelele de bază sunt prea
corelate ca să existe ce combina mai bine. **Problema nu e cum combini, ci ce
combini.**

## xG

Understat a închis accesul programatic (pagina nu mai încorporează datele,
endpoint-urile AJAX dau 404). Sursa folosită: `vaastav/Fantasy-Premier-League`,
`expected_goals` per jucător per etapă, agregat pe echipă și meci. Doar Premier
League, 2022/23–2025/26. 1.501 din 1.520 de meciuri lipite cu cotele (98.8%).
834 de meciuri OOS. `node scripts/xgReport.js`.

| Variantă | RPS | Acuratețe | vs piață |
|---|---|---|---|
| **piață singură** | **0.19791** | 53.2% | — |
| stacking fără piață | 0.20575 | 51.2% | −3.96% |
| stacking + xG, fără piață | 0.20471 | 52.4% | −3.44% |
| stacking CU piață | 0.20044 | 52.5% | −1.28% |
| stacking + xG CU piață | 0.20100 | 53.0% | −1.56% |

Rezultatul are două părți, și ambele contează:

1. **xG face modelul mai bun** — fără piață, câștigă 0.5 puncte (−3.96% →
   −3.44%) și 1.2pp de acuratețe. Ipoteza că golurile sunt un semnal zgomotos
   se confirmă.
2. **Dar nu-l face mai bun decât piața.** Odată ce piața e în stack, xG-ul nu
   mai adaugă nimic (−0.28%). **Piața prețuiește deja xG-ul** — informația e
   reală, doar că nu e privată.

### Limitări ale acestui test

- **xG-ul e rotunjit la întreg** ca să intre în Dixon-Coles, care e un model
  discret. Un meci cu 1.4 – 0.6 xG devine 1 – 1. Se pierde informație; un model
  continuu pe xG (ex. Poisson cu λ = xG mediu) ar putea face mai bine.
- **Eșantion mic**: 834 de meciuri OOS, o singură ligă. Meta-learnerul costă
  singur ~0.3% din zgomot de estimare la mărimea asta („doar piața ca feature"
  −0.34%, față de −0.08% pe 8.082 de meciuri).

Niciuna nu schimbă concluzia direcțională: xG ajută modelul, nu îl duce peste
piață.

---

# Concluzia întregii cercetări

Testat, cu date reale și walk-forward point-in-time:

| Ce | Rezultat |
|---|---|
| 1X2 pe 5 ligi mari | modelul e în urma pieței −1.8% … −7.6% |
| 1X2 pe ligi mici (Liga I/II etc.) | la fel — amestecul optim e 0% model |
| Over/Under 2.5 | 0 PASS din 66 de slice-uri |
| Asian Handicap | 0 PASS din 19 slice-uri |
| Dublă șansă | cea mai mică pierdere: −1.4% |
| Bilete combinate | marja se compune: 4 picioare −13.5% |
| Mișcarea liniei | semnal real, inutilizabil |
| 38 de ipoteze de piață | niciuna pozitivă |
| Ponderi optimizate | +0.02% pe test |
| Stacking | +0.22% față de blend, −0.31% față de piață |
| xG | ajută modelul, nu-l duce peste piață |

**Piața e eficientă pe tot ce avem acces.** Fiecare sursă de informație pe care
o poate folosi un model public — goluri, formă, H2H, Elo, xG — e deja în preț.

Ce ar putea schimba asta ține de informație, nu de model: absențe de lot
înainte să intre în cotă, cote de deschidere prinse devreme, piețe unde
bookmakerul are marjă mare și volum mic. Niciuna nu e accesibilă cu datele
gratuite folosite aici.
