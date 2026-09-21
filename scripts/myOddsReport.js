#!/usr/bin/env node
/**
 * Cotele TALE (PredictCamp, livescore „pre") vs linia sharp Pinnacle.
 *
 * Întrebarea: cotele pe care le vezi tu sunt vreodată mai bune decât prețul
 * corect? Dacă da, acolo e valoarea — fără niciun model.
 *
 * Trei teste, fiindcă sursele nu au aceleași momente:
 *
 *  A. Fără selecție: cât de des cota ta depășește prețul corect Pinnacle la
 *     închidere. Fără look-ahead, fiindcă nu alegem nimic.
 *  B. Selecție FĂRĂ look-ahead (doar ligile cu Pinnacle la deschidere):
 *     pariezi când cota ta bate Pinnacle-ul de LA DESCHIDERE, care e
 *     disponibil înainte de meci. CLV măsurat real, față de închidere.
 *  C. Limită superioară (toate ligile, inclusiv Liga I): pariezi când cota ta
 *     bate Pinnacle-ul de LA ÎNCHIDERE. Asta folosește informație pe care n-o
 *     ai la momentul pariului — răspunde doar „cât valorează dacă ai avea
 *     linia sharp în timp real".
 *
 *   node scripts/myOddsReport.js
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadMainSeasons, loadExtraLeague } from '../src/lib/footballData.js';
import { matchFixtures } from '../src/lib/teamMatch.js';
import { devig } from '../src/betting/odds.js';
import { promotionVerdict } from '../src/lib/robustness.js';

const MAIN = { PL: 'E0', PD: 'SP1', SA: 'I1', BL1: 'D1', FL1: 'F1', 77: 'E1', 8: 'P1', 6: 'T1', 196: 'N1', 68: 'B1', 75: 'SC0' };
const EXTRA = { 61: 'ROU', 60: 'POL', 43: 'AUT', 76: 'USA', 45: 'MEX' };
const SEASONS = ['2021', '2122', '2223', '2324', '2425', '2526'];
const THRESHOLDS = [0, 2, 4, 6];
const OUT = ['1', 'X', '2'];
const fair = (o) => devig(o, { method: 'shin' }).fair_probabilities;

const mine = JSON.parse(await readFile(path.resolve('data/cache/predictcamp_odds.json'), 'utf8'))
  .filter((m) => [m.o1, m.ox, m.o2].every((x) => x > 1));
console.error(`Cotele tale: ${mine.length} meciuri\n`);

/* ---------- lipirea cu Pinnacle ---------- */

const joined = [];
const coverage = [];
for (const [pcCode, fdCode] of [...Object.entries(MAIN), ...Object.entries(EXTRA)]) {
  const left = mine.filter((m) => m.league === pcCode);
  if (!left.length) continue;
  let right;
  try {
    right = MAIN[pcCode]
      ? await loadMainSeasons(fdCode, SEASONS)
      : await loadExtraLeague(fdCode);
  } catch (err) { console.error(`${fdCode}: ${err.message}`); continue; }
  right = right.filter((r) => r.books?.pinnacle?.close);

  const { pairs, unmatched, ambiguous } = matchFixtures(left, right);
  coverage.push({ pc: pcCode, name: left[0].league_name, fd: fdCode, mine: left.length, matched: pairs.length, unmatched, ambiguous });
  for (const { left: l, right: r } of pairs) {
    // Verificare de sanitate: scorul trebuie să coincidă, altfel lipirea e greșită.
    if (l.hg !== r.homeGoals || l.ag !== r.awayGoals) continue;
    joined.push({
      league: pcCode, league_name: l.league_name, date: l.date,
      mine: [l.o1, l.ox, l.o2],
      pinOpen: r.books.pinnacle.open,
      pinClose: r.books.pinnacle.close,
      outcome: r.outcome,
    });
  }
}

console.log(`\n${'═'.repeat(96)}`);
console.log('LIPIREA — cotele tale (PredictCamp) cu Pinnacle (football-data.co.uk)');
console.log('═'.repeat(96));
console.log('ligă'.padEnd(26) + 'cotele tale'.padStart(12) + 'lipite'.padStart(9) + 'rată'.padStart(8) + 'ambigue'.padStart(9));
for (const c of coverage) {
  console.log(`${c.name} (${c.fd})`.padEnd(26) + String(c.mine).padStart(12) + String(c.matched).padStart(9) +
    `${((c.matched / c.mine) * 100).toFixed(0)}%`.padStart(8) + String(c.ambiguous).padStart(9));
}
console.log(`\nTotal lipite cu scor identic: ${joined.length}`);

const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));

/* ---------- A. cât de des cota ta bate prețul corect ---------- */

console.log(`\n${'═'.repeat(96)}`);
console.log('A. CÂT DE DES COTA TA BATE PREȚUL CORECT PINNACLE LA ÎNCHIDERE (fără selecție)');
console.log('═'.repeat(96));
console.log('ligă'.padEnd(26) + 'rezultate'.padStart(10) + 'peste corect'.padStart(14) + 'marja ta'.padStart(10) + 'marja Pinn.'.padStart(12));
const byLeague = new Map();
for (const j of joined) {
  const g = byLeague.get(j.league) ?? { name: j.league_name, total: 0, above: 0, mMine: 0, mPin: 0, n: 0 };
  const pc = fair(j.pinClose);
  for (let k = 0; k < 3; k++) {
    g.total++;
    if (j.mine[k] * pc[k] > 1) g.above++;
  }
  g.mMine += j.mine.reduce((s, o) => s + 1 / o, 0) - 1;
  g.mPin += j.pinClose.reduce((s, o) => s + 1 / o, 0) - 1;
  g.n++;
  byLeague.set(j.league, g);
}
for (const g of [...byLeague.values()].sort((a, b) => b.above / b.total - a.above / a.total)) {
  console.log(g.name.padEnd(26) + String(g.total).padStart(10) + `${f((g.above / g.total) * 100)}%`.padStart(14) +
    `${f((g.mMine / g.n) * 100)}%`.padStart(10) + `${f((g.mPin / g.n) * 100)}%`.padStart(12));
}

/* ---------- B și C ---------- */

function run(refKey) {
  const rows = [];
  for (const th of THRESHOLDS) {
    const bets = [];
    for (const j of joined) {
      const ref = j[refKey];
      if (!ref) continue;
      const pr = fair(ref), pc = fair(j.pinClose);
      for (let k = 0; k < 3; k++) {
        const ev = j.mine[k] * pr[k] - 1;
        if (ev * 100 < th) continue;
        const hit = j.outcome === OUT[k];
        bets.push({
          league: j.league, date: j.date, hit, odds: j.mine[k],
          profit: hit ? j.mine[k] - 1 : -1,
          ev,
          // CLV real doar când referința de decizie NU e închiderea.
          clv: refKey === 'pinClose' ? null : (j.mine[k] * pc[k] - 1) * 100,
        });
      }
    }
    if (bets.length < 30) continue;
    const v = promotionVerdict(bets);
    const clvs = bets.map((b) => b.clv).filter(Number.isFinite);
    rows.push({ th, n: bets.length, hit: bets.filter((b) => b.hit).length / bets.length * 100,
      odds: bets.reduce((a, b) => a + b.odds, 0) / bets.length,
      ev: bets.reduce((a, b) => a + b.ev, 0) / bets.length * 100,
      clv: clvs.length ? clvs.reduce((a, c) => a + c, 0) / clvs.length : null, ...v });
  }
  return rows;
}

const printRows = (title, rows, note) => {
  console.log(`\n${'═'.repeat(96)}`);
  console.log(title);
  console.log('═'.repeat(96));
  console.log('prag EV'.padEnd(10) + 'n'.padStart(7) + 'reușită'.padStart(9) + 'cotă'.padStart(7) + 'EV decl.'.padStart(10) +
    'ROI'.padStart(8) + 'p05'.padStart(8) + 'p95'.padStart(8) + 'CLV'.padStart(8) + '  verdict');
  console.log('─'.repeat(96));
  for (const r of rows) {
    console.log(`≥${r.th}%`.padEnd(10) + String(r.n).padStart(7) + `${f(r.hit)}%`.padStart(9) + f(r.odds, 2).padStart(7) +
      `${f(r.ev)}%`.padStart(10) + `${f(r.bootstrap.roi_pct)}%`.padStart(8) + `${f(r.bootstrap.p05)}%`.padStart(8) +
      `${f(r.bootstrap.p95)}%`.padStart(8) + `${f(r.clv)}%`.padStart(8) + '  ' +
      (r.verdict === 'PASS' ? 'PASS' : `FAIL (${r.reasons[0]})`));
  }
  if (note) console.log(note);
};

printRows('B. FĂRĂ LOOK-AHEAD — cota ta vs Pinnacle LA DESCHIDERE (doar ligile principale)',
  run('pinOpen'), 'CLV = cota ta față de prețul corect Pinnacle la închidere. Pozitiv = linia s-a mișcat în favoarea ta.');
printRows('C. LIMITĂ SUPERIOARĂ — cota ta vs Pinnacle LA ÎNCHIDERE (toate ligile, inclusiv Liga I)',
  run('pinClose'), '⚠ Folosește închiderea, pe care n-o știi când pariezi. Arată cât valorează o linie sharp în timp real,\n  nu un profit obtenabil acum.');

/* ---------- Liga I, separat ---------- */

const ro = joined.filter((j) => j.league === '61');
if (ro.length) {
  const bets = [];
  for (const j of ro) {
    const pc = fair(j.pinClose);
    for (let k = 0; k < 3; k++) {
      if (j.mine[k] * pc[k] - 1 < 0) continue;
      const hit = j.outcome === OUT[k];
      bets.push({ date: j.date, hit, odds: j.mine[k], profit: hit ? j.mine[k] - 1 : -1 });
    }
  }
  const v = promotionVerdict(bets);
  console.log(`\nLiga I separat — ${ro.length} meciuri lipite, ${bets.length} rezultate unde cota ta bate Pinnacle la închidere:`);
  console.log(`  ROI ${f(v.bootstrap?.roi_pct)}%, interval [${f(v.bootstrap?.p05)}%, ${f(v.bootstrap?.p95)}%], ${v.verdict}` +
    (v.reasons.length ? ` (${v.reasons.join('; ')})` : ''));
  console.log('  (limită superioară — același avertisment ca la C)');
}
console.log();
