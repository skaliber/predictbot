#!/usr/bin/env node
/**
 * Validează regula de piețe alternative: când `granular-stats` arată o abatere
 * de la baseline-ul ligii, chiar se confirmă rezultatul indicat?
 *
 *   node scripts/validateGranular.js --from=2025-08-01 --to=2026-06-30
 */
import { listMatches } from '../src/dataFetcher.js';
import { historicalGranular, altMarketOutcome } from '../src/bot/historicalGranular.js';
import { granularMarkets } from '../src/bot/screening.js';
import { wilsonInterval } from '../src/lib/stats.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
if (!args.from || !args.to) { console.error('--from și --to obligatorii'); process.exit(1); }
const leagues = (args.leagues ?? 'PL,PD,SA,BL1,FL1').split(',').map((s) => s.trim());
const minDelta = Number(args['min-delta'] ?? 10);

async function load(league) {
  const rows = await listMatches({ status: 'FINISHED', league, from: args.from, to: args.to, limit: 800 });
  return rows
    .filter((m) => Number.isFinite(m.score_home) && Number.isFinite(m.score_away))
    .map((m) => ({ home: m.home_team, away: m.away_team, homeGoals: m.score_home, awayGoals: m.score_away, date: m.match_date }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const signals = [];   // meciuri unde regula a dat un semnal
const noSignal = [];  // meciuri fără semnal, pentru comparație

for (const league of leagues) {
  const all = await load(league);
  const minTrain = Math.max(80, Math.floor(all.length * 0.45));
  if (all.length < minTrain + 20) continue;
  for (let i = minTrain; i < all.length; i++) {
    const history = all.slice(0, i);
    const target = all[i];
    const g = historicalGranular(history, target.home, target.away);
    if (!g) continue;
    const markets = granularMarkets(g, { minSample: 10, minDelta });
    if (!markets.length) {
      // Fără semnal: reținem rezultatele de bază pentru comparație.
      const total = target.homeGoals + target.awayGoals;
      noSignal.push({ over: total > 2.5, btts: target.homeGoals > 0 && target.awayGoals > 0 });
      continue;
    }
    for (const m of markets) {
      signals.push({
        league, market: m.market, selection: m.selection,
        delta: m.delta_vs_baseline, granular_pct: m.granular_pct,
        hit: altMarketOutcome(target, m.selection),
      });
    }
  }
  console.error(`${league}: procesat`);
}

if (!signals.length) { console.error('Niciun semnal generat.'); process.exit(1); }

const pct = (x) => `${x.toFixed(1)}%`;
const group = (rows) => {
  const wins = rows.filter((r) => r.hit).length;
  return { n: rows.length, wins, rate: (wins / rows.length) * 100, ci: wilsonInterval(wins, rows.length) };
};

console.log(`\n=== Validare piețe alternative — prag delta ${minDelta}pp, ${leagues.join('/')} ===\n`);
console.log('selecție'.padEnd(14) + 'n'.padStart(6) + 'confirmat'.padStart(11) + 'IC 95%'.padStart(16));
for (const sel of ['Over 2.5', 'Under 2.5', 'BTTS Yes', 'BTTS No']) {
  const rows = signals.filter((s) => s.selection === sel);
  if (!rows.length) continue;
  const g = group(rows);
  console.log(sel.padEnd(14) + String(g.n).padStart(6) + pct(g.rate).padStart(11) + `${g.ci[0].toFixed(0)}–${g.ci[1].toFixed(0)}%`.padStart(16));
}

console.log('\n--- Confirmare în funcție de mărimea abaterii ---\n');
console.log('delta'.padEnd(14) + 'n'.padStart(6) + 'confirmat'.padStart(11) + 'IC 95%'.padStart(16));
for (const [lo, hi] of [[minDelta, 15], [15, 20], [20, 30], [30, 1000]]) {
  const rows = signals.filter((s) => s.delta >= lo && s.delta < hi);
  if (rows.length < 10) continue;
  const g = group(rows);
  console.log(`${lo}–${hi === 1000 ? '∞' : hi}pp`.padEnd(14) + String(g.n).padStart(6) + pct(g.rate).padStart(11) + `${g.ci[0].toFixed(0)}–${g.ci[1].toFixed(0)}%`.padStart(16));
}

// Reper: cât de des ies piețele fără niciun semnal.
if (noSignal.length) {
  const overBase = (noSignal.filter((r) => r.over).length / noSignal.length) * 100;
  const bttsBase = (noSignal.filter((r) => r.btts).length / noSignal.length) * 100;
  console.log(`\nReper (meciuri fără semnal, n=${noSignal.length}): Over 2.5 ${pct(overBase)}, BTTS ${pct(bttsBase)}`);
  console.log('Un semnal util trebuie să bată reperul în direcția pe care o indică.\n');
}
