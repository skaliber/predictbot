# Adaptare din lnmomo/Gambling

Studiat 21 septembrie 2026. <https://github.com/lnmomo/Gambling>

## Ce e proiectul

Sistem multi-agent Python pentru pariuri pe Loteria Sportivă Chineză (prețuri
„SP" oficiale). 4.967 de fișiere, 624 MB, peste 300 de teste. Arhitectură:
colectare de cote → model de probabilități → „True Odds Engine" (de-vig multiplu)
→ filtru de calitate a edge-ului → reguli „critic" → control de bankroll →
recomandare sau `NO_BET` → backtest → validare „shadow" → poartă de promovare.

Nu plasează pariuri. E declarat ca platformă de cercetare.

## Ce au găsit

Documentul lor de rezultate (`docs/17_profit_algorithm_findings.md`, 2.925 de
linii) e onest și ajunge exact unde am ajuns și noi: **niciun candidat
promovabil.** Toate direcțiile sunt marcate `REJECTED`:

- egalurile din Segunda spaniolă — primul lor candidat, instabil între sezoane
- selectoare de reguli fără look-ahead — prea puține pariuri
- rezidualuri ancorate pe piață pe MLS/Norvegia/Brazilia — respinse la bootstrap
- „external-consensus challenger", ideea lor cea mai bună — la prima rulare live:
  13 decizii, **0 candidați**

E o confirmare independentă: o echipă cu infrastructură de câteva ori mai mare
decât a noastră n-a găsit edge prin modelare.

## Ce am preluat

### 1. Ipoteza „named-book gap" — testată, e singurul rezultat pozitiv

Ideea lor centrală nu compară un **model** cu piața. Compară **o casă anume**
cu consensul sharp. Dacă o casă oferă o cotă peste cea corectă implicată de
Pinnacle (de-vigată), pariul are EV pozitiv — fără niciun model.

`node scripts/namedBookGap.js` — 34.481 de meciuri, 19 ligi, 5 sezoane:

| Strategie | n | ROI | p05 | Verdict |
|---|---|---|---|---|
| **Max pieței, EV ≥0%** | 40.093 | **+2.4%** | **+1.2%** | PASS* |
| **Max pieței, EV ≥2%** | 19.466 | **+3.0%** | **+1.1%** | PASS* |
| **Max pieței, EV ≥4%** | 9.492 | **+5.0%** | **+1.8%** | PASS* |
| Bet365 deschidere, EV ≥0% | 3.784 | +3.8% | −0.9% | FAIL |
| Bet365 închidere, EV ≥4% | 461 | +12.9% | −3.6% | FAIL |

\* neexecutabil ca atare — vezi mai jos.

**E primul rezultat pozitiv și robust statistic din toată cercetarea.** Iar
ROI-ul pe Bet365 (o casă reală, executabilă) e pozitiv în 7 din 8 rânduri; doar
varianța îl ține sub pragul de semnificație.

Interpretarea: **line shopping funcționează.** Nu trebuie să prezici meciuri
mai bine decât piața — trebuie să găsești prețurile pe care o casă anume le-a
greșit față de linia sharp.

#### De ce „Max" nu e profit executabil

Chiar proiectul de referință avertizează explicit, și are dreptate:

- „Max" e cea mai bună cotă dintre **toate** casele din sursă. Ar cere cont
  deschis la toate.
- Include cote eronate pe care casele le anulează („palpable error").
- Casele limitează sau închid conturile care câștigă consistent din line shopping.
- Sunt cote de **închidere**; cele disponibile când pariezi pot diferi.

Rezultatul arată că edge-ul **există în prețuri**. Nu arată că poate fi
extras integral.

### 2. Verificări de robustețe mai stricte (`src/lib/robustness.js`)

- **Bootstrap pe blocuri de zi.** Pariurile din aceeași zi sunt corelate. Pe
  pariu, intervalul de încredere iese prea îngust — testul nostru arată o
  diferență de peste 2x la corelare mare. Aceleași setări ca la ei (seed 42,
  5.000 de iterații).
- **Concentrarea profitului.** Dacă top-5 câștiguri fac majoritatea profitului,
  e noroc. A prins deja Grecia: ROI p05 pozitiv, dar 60% din profit în 5 pariuri.
- **Test sign-flip** pe profitul zilnic.
- **EV conservator**: marjă de incertitudine + haircut de execuție de 2%.

### 3. Capcana CLV-ului circular — confirmată a doua oară

Dacă selectezi pariuri după „cotă × p_referință − 1 ≥ prag" și măsori CLV față
de aceeași referință, CLV = EV-ul de filtrare. Am căzut în ea în `edgeReport` și
din nou în `namedBookGap`. Acum există test de regresie.

## Ce merită preluat în continuare

În ordinea valorii:

1. **Scanner de line shopping în timp real** pe casele românești (Superbet,
   Betano, Casa Pariurilor, Fortuna, Unibet, NetBet) față de linia Pinnacle.
   E singura direcție cu rezultat pozitiv. Are nevoie de o sursă de cote în
   timp real pe mai multe case — The Odds API (plătit, ~20–100 $/lună) sau
   scraping. **Decizia de cost e a ta.**
2. **Registru prospectiv imuabil.** Ei îngheață fiecare decizie înainte de
   start, cu garanție de timestamp (`observat ≤ scorat < kickoff`), și nu
   recalculează nimic după rezultat. Crawler-ul nostru salvează predicții, dar
   nu garantează asta. E singura cale de a dovedi edge **înainte** să pariezi
   bani — backtestul istoric are limitele lui.
3. **Model ancorat pe piață**: modelul poate muta probabilitatea pieței cu cel
   mult ±2–3 puncte, nu o înlocuiește. Adresează direct concluzia noastră că
   modelul e redundant. Plus proiecția înapoi la sumă 1 — altfel rezidualurile
   independente „fabrică" masă de probabilitate și EV fals.
4. **Control de drawdown pe trepte**: CAUTION la 2 zile pierzătoare sau −10%,
   DEFENSIVE la 4 zile sau −15%, PAUSED la 6 zile sau −20%.
5. **Holdout sigilat pe ultima lună**, cu hash pe dataset, ca o strategie să nu
   poată fi evaluată de două ori pe aceeași lună.

## Ce NU merită preluat

- Tot stack-ul pentru Loteria Chineză (SP oficial, scraping prin browser CDP,
  arhiva Sporttery) — irelevant pentru piața românească.
- Integrarea cu Qwen — la ei dă `403 FreeTierOnly` oricum.
- Cele 624 MB de rapoarte de experimente acumulate.
