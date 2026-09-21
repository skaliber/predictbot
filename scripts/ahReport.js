#!/usr/bin/env node
/**
 * Asian Handicap — ultima piață netestată cu cote reale.
 *
 * De ce ar putea fi mai bună decât 1X2: elimină egalul din ecuație, iar
 * handicapul absoarbe diferența de valoare, deci modelul nu mai trebuie să
 * prezică un rezultat în trei stări. Dacă avantajul lui e în estimarea
 * diferenței de goluri (și acolo e, prin lambda), AH e locul unde ar trebui
 * să se vadă.
 *
 * Și BTTS, cât se poate: sursa nu are cote, deci se măsoară doar calibrarea —
 * cât de bine prezice modelul, nu dacă s-ar fi câștigat bani.
 *
 *   node scripts/ahReport.js --main=E0,E1,D1,I1,SP1 --seasons=2021,2122,2223,2324,2425
 */
import { loadMainSeasons } from '../src/lib/footballData.js';
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { settleHandicap, coverProbability } from '../src/lib/asianHandicap.js';
import { closingProbs, clvPoints, logLossBinary, bootstrapRoi } from '../src/lib/clv.js';
import { wilsonInterval } from '../src/lib/stats.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
const SEASONS = (args.seasons ?? '2021,2122,2223,2324,2425').split(',').map((s) => s.trim());
const TRAIN_MIN = Number(args['train-min'] ?? 380);
const WINDOW = Number(args.window ?? 1140);
const THRESHOLDS = (args.thresholds ?? '2,3,5').split(',').map(Number);

const ahBets = [];
const bttsRows = [];

for (const code of (args.main ?? 'E0,E1,D1,I1,SP1').split(',').map((s) => s.trim())) {
  const rows = await loadMainSeasons(code, SEASONS);
  let n = 0, withAh = 0;
  for (let i = TRAIN_MIN; i < rows.length; i++) {
    const t = rows[i];
    const history = rows.slice(Math.max(0, i - WINDOW), i);
    if (history.length < 200) continue;

    let fit;
    try {
      fit = fitDixonColes(history, { referenceDate: t.date });
      lambdasFromFit(fit, t.home, t.away);
    } catch { continue; }
    const dc = predictDixonColes({ fit, home: t.home, away: t.away });
    n++;

    // BTTS: fără cote în sursă, măsurăm doar calibrarea.
    bttsRows.push({ league: code, prob: dc.btts_yes, happened: t.btts });

    // AH: pariem la DESCHIDERE, comparăm cu ÎNCHIDEREA.
    const line = t.ahLineOpen;
    if (line === null || !t.ahOpeningOdds || !t.ahClosingOdds) continue;
    withAh++;

    const openFair = closingProbs(t.ahOpeningOdds);
    const closeFair = closingProbs(t.ahClosingOdds);
    if (!openFair || !closeFair) continue;

    for (const [side, k] of [['home', 0], ['away', 1]]) {
      const pModel = coverProbability({ matrix: dc.matrix, line, side });
      if (!Number.isFinite(pModel)) continue;
      const s = settleHandicap({
        homeGoals: t.homeGoals, awayGoals: t.awayGoals, line, side, odds: t.ahOpeningOdds[k],
      });
      if (!s) continue;
      ahBets.push({
        league: code, side, line, date: t.date,
        modelProb: pModel, openProb: openFair[k], closeProb: closeFair[k],
        edge_pp: (pModel - openFair[k]) * 100,
        odds: t.ahOpeningOdds[k],
        profit: s.profit,
        outcome: s.outcome,
        hit: s.profit > 0,
        clv: clvPoints({ openProb: openFair[k], closingProb: closeFair[k] }),
        logLossModel: logLossBinary(pModel, s.profit > 0),
        logLossMarket: logLossBinary(openFair[k], s.profit > 0),
      });
    }
  }
  console.error(`${code}: ${n} meciuri, ${withAh} cu linie AH`);
}

const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));

/** ROI pentru AH: profitul e fracționar (push, jumătăți), nu doar ±1. */
function ahSummary(bets) {
  if (!bets.length) return null;
  const profit = bets.reduce((a, b) => a + b.profit, 0);
  const clvs = bets.map((b) => b.clv).filter(Number.isFinite);
  const boot = bootstrapRoi(bets.map((b) => ({ hit: b.profit > 0, odds: 1 + Math.max(0, b.profit) })));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    n: bets.length,
    roi_pct: (profit / bets.length) * 100,
    ci95: boot.ci95,
    mean_clv_pp: avg(clvs),
    pushes: bets.filter((b) => b.outcome === 'push').length,
    halves: bets.filter((b) => b.outcome.startsWith('half')).length,
    logloss_model: avg(bets.map((b) => b.logLossModel).filter(Number.isFinite)),
    logloss_market: avg(bets.map((b) => b.logLossMarket).filter(Number.isFinite)),
  };
}

console.log(`\n${'═'.repeat(100)}`);
console.log('ASIAN HANDICAP — pariu la deschidere, CLV vs închidere, walk-forward');
console.log('PASS cere: CLV > 0  ȘI  ROI > 0  ȘI  n ≥ 200');
console.log('═'.repeat(100));

if (!ahBets.length) {
  console.log('\nNiciun pariu AH generat — verifică dacă sursa are coloanele AHh/PAHH.\n');
} else {
  console.log('slice'.padEnd(32) + 'n'.padStart(6) + 'ROI'.padStart(9) + 'IC 95%'.padStart(18) +
    'CLV'.padStart(9) + 'push'.padStart(7) + 'LL mod'.padStart(9) + 'LL piață'.padStart(9) + '  verdict');
  console.log('─'.repeat(100));
  const out = [];
  for (const th of THRESHOLDS) {
    const picks = ahBets.filter((b) => b.edge_pp >= th);
    if (picks.length >= 50) out.push([`TOATE · edge≥${th}pp`, ahSummary(picks)]);
    for (const lg of [...new Set(ahBets.map((b) => b.league))]) {
      const lp = picks.filter((b) => b.league === lg);
      if (lp.length >= 100) out.push([`${lg} · edge≥${th}pp`, ahSummary(lp)]);
    }
  }
  // Referință: toate pariurile AH, fără filtru de model.
  out.push(['TOATE · fără filtru', ahSummary(ahBets)]);

  for (const [label, s] of out.sort((a, b) => (b[1].mean_clv_pp ?? -99) - (a[1].mean_clv_pp ?? -99))) {
    const pass = s.mean_clv_pp > 0 && s.roi_pct > 0 && s.n >= 200;
    console.log(
      label.padEnd(32) + String(s.n).padStart(6) + `${f(s.roi_pct, 1)}%`.padStart(9) +
      `[${f(s.ci95[0], 1)}, ${f(s.ci95[1], 1)}]`.padStart(18) +
      `${f(s.mean_clv_pp, 2)}pp`.padStart(9) + String(s.pushes).padStart(7) +
      f(s.logloss_model, 3).padStart(9) + f(s.logloss_market, 3).padStart(9) +
      '  ' + (pass ? 'PASS' : 'FAIL')
    );
  }
}

console.log(`\n${'═'.repeat(100)}`);
console.log('BTTS — fără cote în sursă, deci doar calibrare (nu ROI)');
console.log('═'.repeat(100));
if (bttsRows.length) {
  console.log('bucket'.padEnd(14) + 'n'.padStart(7) + 'prezis'.padStart(10) + 'real'.padStart(9) +
    'eroare'.padStart(10) + 'IC 95%'.padStart(16));
  for (const [lo, hi] of [[0, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 1.01]]) {
    const g = bttsRows.filter((r) => r.prob >= lo && r.prob < hi);
    if (g.length < 30) continue;
    const yes = g.filter((r) => r.happened).length;
    const predicted = g.reduce((s, r) => s + r.prob, 0) / g.length * 100;
    const actual = (yes / g.length) * 100;
    const ci = wilsonInterval(yes, g.length);
    console.log(
      `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`.padEnd(14) + String(g.length).padStart(7) +
      `${f(predicted, 1)}%`.padStart(10) + `${f(actual, 1)}%`.padStart(9) +
      `${actual - predicted > 0 ? '+' : ''}${f(actual - predicted, 1)}pp`.padStart(10) +
      `[${f(ci[0], 0)}, ${f(ci[1], 0)}]`.padStart(16)
    );
  }
  const ll = bttsRows.reduce((s, r) => s + logLossBinary(r.prob, r.happened), 0) / bttsRows.length;
  const base = bttsRows.filter((r) => r.happened).length / bttsRows.length;
  const llBase = bttsRows.reduce((s, r) => s + logLossBinary(base, r.happened), 0) / bttsRows.length;
  console.log(`\nLog-loss model ${f(ll, 4)} vs rata de bază ${f(llBase, 4)} — ` +
    (ll < llBase ? `modelul adaugă ${f(((llBase - ll) / llBase) * 100, 1)}%` : 'modelul nu adaugă nimic'));
  console.log('Fără cote nu se poate spune dacă ar fi fost profitabil.\n');
}
