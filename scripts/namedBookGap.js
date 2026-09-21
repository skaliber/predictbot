#!/usr/bin/env node
/**
 * „Named-book gap" — ideea centrală din lnmomo/Gambling, testată pe datele noastre.
 *
 * Nu compară un MODEL cu piața. Compară O CASĂ ANUME cu referința sharp:
 * dacă o casă „moale" oferă, pe un rezultat, o cotă peste cota corectă
 * implicată de Pinnacle (de-vigată), pariul are EV pozitiv — fără niciun model.
 *
 * Pentru un pariorul din România, „casa moale" ar fi Superbet/Betano/Casa
 * Pariurilor; sursa noastră are doar Bet365, media pieței și maximul, deci
 * Bet365 ține loc de „casa ta".
 *
 * Fără look-ahead: la fiecare moment, referința e DIN ACELAȘI moment.
 *   · decizie la deschidere → referință = Pinnacle la deschidere
 *   · decizie la închidere  → referință = Pinnacle la închidere
 * CLV-ul se măsoară separat, față de Pinnacle la închidere.
 *
 *   node scripts/namedBookGap.js
 */
import { loadMainSeasons } from '../src/lib/footballData.js';
import { devig } from '../src/betting/odds.js';
import { promotionVerdict, conservativeEv } from '../src/lib/robustness.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
const LEAGUES = (args.leagues ?? 'E0,E1,E2,E3,SC0,SC1,D1,D2,I1,I2,SP1,SP2,F1,F2,N1,B1,P1,T1,G1')
  .split(',').map((s) => s.trim());
const SEASONS = (args.seasons ?? '2021,2122,2223,2324,2425').split(',').map((s) => s.trim());
const THRESHOLDS = (args.thresholds ?? '0,2,4,6').split(',').map(Number);
const OUT = ['1', 'X', '2'];

const fair = (odds) => devig(odds, { method: 'shin' }).fair_probabilities;

const rows = [];
for (const lg of LEAGUES) {
  try {
    const r = await loadMainSeasons(lg, SEASONS);
    rows.push(...r.filter((m) => m.books));
    console.error(`${lg}: ${r.length} meciuri`);
  } catch (err) { console.error(`${lg}: ${err.message}`); }
}
console.error(`\nTotal: ${rows.length} meciuri\n`);

/**
 * Strategiile testate. `exec` = unde pariezi, `ref` = referința sharp din
 * același moment. `executable: false` marchează limitele superioare.
 */
const STRATEGIES = [
  { name: 'Bet365 deschidere', exec: 'b365', when: 'open', ref: 'open', executable: true },
  { name: 'Bet365 închidere', exec: 'b365', when: 'close', ref: 'close', executable: true },
  { name: 'Media pieței închidere', exec: 'market_avg', when: 'close', ref: 'close', executable: false },
  { name: 'Max pieței închidere', exec: 'market_max', when: 'close', ref: 'close', executable: false },
];

const results = [];
for (const st of STRATEGIES) {
  for (const th of THRESHOLDS) {
    const bets = [];
    for (const m of rows) {
      const execOdds = m.books[st.exec]?.[st.when];
      const refOdds = m.books.pinnacle?.[st.ref];
      const pinClose = m.books.pinnacle?.close;
      if (!execOdds || !refOdds) continue;
      const pRef = fair(refOdds);
      const pClose = pinClose ? fair(pinClose) : null;
      for (let k = 0; k < 3; k++) {
        // EV față de probabilitatea corectă a referinței sharp.
        const ev = pRef[k] * execOdds[k] - 1;
        if (ev * 100 < th) continue;
        const hit = m.outcome === OUT[k];
        bets.push({
          league: m.league, date: m.date, hit, odds: execOdds[k],
          profit: hit ? execOdds[k] - 1 : -1,
          ev,
          cons_ev: conservativeEv({ prob: pRef[k], odds: execOdds[k] }),
          // CLV: cota ta vs cota corectă la închiderea Pinnacle.
          clv_pct: pClose ? (execOdds[k] * pClose[k] - 1) * 100 : null,
        });
      }
    }
    if (bets.length < 30) continue;
    const v = promotionVerdict(bets);
    const clvs = bets.map((b) => b.clv_pct).filter(Number.isFinite);
    results.push({
      strategy: st.name, executable: st.executable, threshold: th,
      n: bets.length,
      hit_pct: (bets.filter((b) => b.hit).length / bets.length) * 100,
      mean_odds: bets.reduce((a, b) => a + b.odds, 0) / bets.length,
      mean_ev_pct: (bets.reduce((a, b) => a + b.ev, 0) / bets.length) * 100,
      mean_clv_pct: clvs.length ? clvs.reduce((a, c) => a + c, 0) / clvs.length : null,
      ...v,
    });
  }
}

const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));
console.log(`\n${'═'.repeat(118)}`);
console.log('NAMED-BOOK GAP — casa ta vs Pinnacle de-vigat, fără model, fără look-ahead');
console.log('PASS: n≥200, ≥30 zile, ROI p05>0 (bootstrap pe zile), top-5 ≤50% din profit, sign-flip p≤0.05');
console.log('═'.repeat(118));
console.log('strategie'.padEnd(26) + 'prag'.padStart(6) + 'n'.padStart(7) + 'reușită'.padStart(9) +
  'cotă'.padStart(7) + 'EV decl.'.padStart(10) + 'ROI'.padStart(9) + 'p05'.padStart(8) + 'p95'.padStart(8) +
  'CLV'.padStart(8) + '  verdict');
console.log('─'.repeat(118));
for (const r of results) {
  const tag = r.executable ? '' : ' *';
  console.log(
    (r.strategy + tag).padEnd(26) + `≥${r.threshold}%`.padStart(6) + String(r.n).padStart(7) +
    `${f(r.hit_pct)}%`.padStart(9) + f(r.mean_odds, 2).padStart(7) +
    `${f(r.mean_ev_pct)}%`.padStart(10) + `${f(r.bootstrap.roi_pct)}%`.padStart(9) +
    `${f(r.bootstrap.p05)}%`.padStart(8) + `${f(r.bootstrap.p95)}%`.padStart(8) +
    `${f(r.mean_clv_pct)}%`.padStart(8) + '  ' +
    (r.verdict === 'PASS' ? (r.executable ? 'PASS' : 'PASS (neexecutabil)') : `FAIL (${r.reasons[0]})`)
  );
}
console.log('─'.repeat(118));
console.log('* = neexecutabil: media și maximul nu sunt prețul unei case anume.');
console.log('„EV decl." = ce promite comparația cu Pinnacle. ROI = ce s-a întâmplat de fapt.\n');

// Pe ligă, doar pentru strategia executabilă de la închidere, la prag zero.
const byLeague = [];
for (const lg of LEAGUES) {
  const bets = [];
  for (const m of rows.filter((r) => r.league === lg)) {
    const e = m.books.b365?.close, p = m.books.pinnacle?.close;
    if (!e || !p) continue;
    const pr = fair(p);
    for (let k = 0; k < 3; k++) {
      if (pr[k] * e[k] - 1 <= 0) continue;
      const hit = m.outcome === OUT[k];
      bets.push({ date: m.date, hit, odds: e[k], profit: hit ? e[k] - 1 : -1 });
    }
  }
  if (bets.length >= 50) byLeague.push({ lg, ...promotionVerdict(bets), n: bets.length });
}
if (byLeague.length) {
  console.log('Pe ligă — Bet365 la închidere, orice EV pozitiv față de Pinnacle:\n');
  console.log('ligă'.padEnd(8) + 'n'.padStart(7) + 'ROI'.padStart(9) + 'p05'.padStart(9) + 'p95'.padStart(9) + '  verdict');
  for (const r of byLeague.sort((a, b) => b.bootstrap.roi_pct - a.bootstrap.roi_pct)) {
    console.log(r.lg.padEnd(8) + String(r.n).padStart(7) + `${f(r.bootstrap.roi_pct)}%`.padStart(9) +
      `${f(r.bootstrap.p05)}%`.padStart(9) + `${f(r.bootstrap.p95)}%`.padStart(9) +
      '  ' + (r.verdict === 'PASS' ? 'PASS' : `FAIL (${r.reasons[0]})`));
  }
  console.log();
}
