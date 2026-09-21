#!/usr/bin/env node
/**
 * Stacking (meta-learner) vs blending cu ponderi fixe vs piață.
 *
 * Trei întrebări, în ordinea importanței:
 *
 *   1. Stackingul bate blendingul fix? (calitate de model)
 *   2. Stackingul bate piața? (are modelul informație independentă?)
 *   3. Stackingul CU prețul pieței ca feature bate piața singură?
 *      ← testul decisiv. Dacă modelul are ceva ce piața n-are, aici se vede.
 *         Dacă nici aici nu, nicio arhitectură nu ajută.
 *
 * Walk-forward strict: meta-learnerul se antrenează doar pe meciuri anterioare.
 *
 *   node scripts/stackingReport.js --main=E0,E1,I1,SP1,D1,N1 --seasons=2021,2122,2223,2324,2425
 */
import { loadMainSeasons } from '../src/lib/footballData.js';
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { buildRatings, predictElo } from '../src/models/elo.js';
import { predictPoisson } from '../src/models/poisson.js';
import { simulate } from '../src/models/monteCarlo.js';
import { blend } from '../src/models/ensemble.js';
import { trainStack } from '../src/models/stacking.js';
import { closingProbs, logLoss } from '../src/lib/clv.js';
import { rps } from './backtest.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
const SEASONS = (args.seasons ?? '2021,2122,2223,2324,2425').split(',').map((s) => s.trim());
const WINDOW = Number(args.window ?? 1140);
const TRAIN_MIN = Number(args['train-min'] ?? 500);
const META_MIN = Number(args['meta-min'] ?? 400);   // meciuri necesare meta-learnerului
const SIMS = Number(args.simulations ?? 3000);
const WEIGHTS = { dixonColes: 0.4, monteCarlo: 0.2, elo: 0.4 };
const CLASS_OF = { '1': 0, X: 1, '2': 2 };

const norm = (s) => {
  const t = s.home_win + s.draw + s.away_win;
  return [s.home_win / t, s.draw / t, s.away_win / t];
};

/** Mediile de goluri, pentru un Poisson naiv ca sursă suplimentară. */
function averages(history, home, away) {
  const stat = (team) => {
    let gf = 0, ga = 0, n = 0;
    for (const m of history) {
      if (m.home === team) { gf += m.homeGoals; ga += m.awayGoals; n++; }
      else if (m.away === team) { gf += m.awayGoals; ga += m.homeGoals; n++; }
    }
    return n ? { gf: gf / n, ga: ga / n } : null;
  };
  const h = stat(home), a = stat(away);
  if (!h || !a) return null;
  return {
    lambdaHome: Math.max(0.15, Math.min(6, (h.gf + a.ga) / 2)),
    lambdaAway: Math.max(0.15, Math.min(6, (a.gf + h.ga) / 2)),
  };
}

/* ---------- pasul 1: predicțiile de bază, o singură dată per meci ---------- */

const samples = [];
for (const code of (args.main ?? 'E0,E1,I1,SP1,D1,N1').split(',').map((s) => s.trim())) {
  const rows = (await loadMainSeasons(code, SEASONS)).filter((r) => r.closingOdds);
  let n = 0;
  for (let i = TRAIN_MIN; i < rows.length; i++) {
    const t = rows[i];
    const history = rows.slice(Math.max(0, i - WINDOW), i);
    if (history.length < 300) continue;

    let fit;
    try {
      fit = fitDixonColes(history, { referenceDate: t.date });
      lambdasFromFit(fit, t.home, t.away);
    } catch { continue; }
    const dc = predictDixonColes({ fit, home: t.home, away: t.away });
    const mc = simulate(dc.matrix, { simulations: SIMS, seed: i });
    const sources = { dixonColes: norm(dc), monteCarlo: norm(mc) };

    const avg = averages(history, t.home, t.away);
    if (avg) sources.poisson = norm(predictPoisson({ lambdaHome: avg.lambdaHome, lambdaAway: avg.lambdaAway }));

    const ratings = buildRatings(history);
    const eloDiff = (ratings[t.home] ?? 1500) - (ratings[t.away] ?? 1500);
    if (Number.isFinite(ratings[t.home]) && Number.isFinite(ratings[t.away])) {
      sources.elo = norm(predictElo({ ratingHome: ratings[t.home], ratingAway: ratings[t.away] }));
    }

    const market = closingProbs(t.closingOdds);
    if (!market) continue;

    samples.push({
      league: code, date: t.date, outcome: t.outcome, label: CLASS_OF[t.outcome],
      sources, market,
      extra: { elo_diff: eloDiff / 100 },
      fixedBlend: (() => {
        const e = blend({
          dixonColes: { home_win: sources.dixonColes[0], draw: sources.dixonColes[1], away_win: sources.dixonColes[2] },
          monteCarlo: { home_win: sources.monteCarlo[0], draw: sources.monteCarlo[1], away_win: sources.monteCarlo[2] },
          ...(sources.elo ? { elo: { home_win: sources.elo[0], draw: sources.elo[1], away_win: sources.elo[2] } } : {}),
        }, WEIGHTS);
        return norm(e);
      })(),
    });
    n++;
  }
  console.error(`${code}: ${n} meciuri`);
}
samples.sort((a, b) => a.date.localeCompare(b.date));
console.error(`\nTotal: ${samples.length} meciuri\n`);
if (samples.length < META_MIN + 100) { console.error('Prea puține meciuri.'); process.exit(1); }

/* ---------- pasul 2: walk-forward pe meta-learner ---------- */

const SOURCE_NAMES = ['dixonColes', 'monteCarlo', 'poisson', 'elo'];
const variants = {
  'blend fix (referință)': null,
  'piață singură': null,
  'stacking fără piață': { sourceNames: SOURCE_NAMES, extraNames: ['elo_diff'] },
  'stacking CU piață': { sourceNames: [...SOURCE_NAMES, 'market'], extraNames: ['elo_diff'] },
  'doar piața ca feature': { sourceNames: ['market'], extraNames: [] },
};
const results = Object.fromEntries(Object.keys(variants).map((k) => [k, []]));

// Re-antrenăm meta-learnerul periodic, nu la fiecare meci (cost).
const RETRAIN_EVERY = Number(args['retrain-every'] ?? 100);
const trained = {};

for (let i = META_MIN; i < samples.length; i++) {
  const s = samples[i];
  if ((i - META_MIN) % RETRAIN_EVERY === 0) {
    const past = samples.slice(0, i);
    const labels = past.map((p) => p.label);
    for (const [name, cfg] of Object.entries(variants)) {
      if (!cfg) continue;
      const rows = past.map((p) => ({
        sources: { ...p.sources, market: p.market },
        extra: p.extra,
      }));
      trained[name] = trainStack(rows, labels, { ...cfg, iterations: 250, l2: 2.0 });
    }
  }
  const row = { sources: { ...s.sources, market: s.market }, extra: s.extra };
  results['blend fix (referință)'].push({ p: s.fixedBlend, outcome: s.outcome });
  results['piață singură'].push({ p: s.market, outcome: s.outcome });
  for (const [name, cfg] of Object.entries(variants)) {
    if (!cfg) continue;
    results[name].push({ p: trained[name].predict(row), outcome: s.outcome });
  }
}

/* ---------- raport ---------- */

const f = (x, d = 5) => (x === null ? '—' : x.toFixed(d));
const evalSet = (rows) => {
  const n = rows.length;
  const avgRps = rows.reduce((a, r) => a + rps(r.p, r.outcome), 0) / n;
  const avgLl = rows.reduce((a, r) => a + logLoss(r.p, r.outcome), 0) / n;
  const acc = rows.filter((r) => ['1', 'X', '2'][r.p.indexOf(Math.max(...r.p))] === r.outcome).length / n;
  return { n, rps: avgRps, logloss: avgLl, acc: acc * 100 };
};

console.log(`\n${'═'.repeat(88)}`);
console.log(`STACKING vs BLENDING vs PIAȚĂ — ${results['piață singură'].length} meciuri OOS, walk-forward`);
console.log('═'.repeat(88));
console.log('variantă'.padEnd(28) + 'RPS'.padStart(10) + 'log-loss'.padStart(11) + 'acuratețe'.padStart(11) + 'vs piață'.padStart(12));
console.log('─'.repeat(88));

const market = evalSet(results['piață singură']);
for (const name of Object.keys(variants)) {
  const e = evalSet(results[name]);
  const delta = ((market.rps - e.rps) / market.rps) * 100;
  console.log(
    name.padEnd(28) + f(e.rps).padStart(10) + f(e.logloss, 4).padStart(11) +
    `${e.acc.toFixed(1)}%`.padStart(11) +
    (name === 'piață singură' ? '—'.padStart(12) : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`.padStart(12))
  );
}
console.log('─'.repeat(88));

const stackMarket = evalSet(results['stacking CU piață']);
const gain = ((market.rps - stackMarket.rps) / market.rps) * 100;
console.log();
if (gain > 0.5) {
  console.log(`✓ Stackingul CU piață bate piața cu ${gain.toFixed(2)}%.`);
  console.log('  Modelul ARE informație pe care piața nu o are.');
} else if (gain > -0.5) {
  console.log(`~ Stackingul CU piață e la egalitate cu piața (${gain.toFixed(2)}%).`);
  console.log('  Modelul nu adaugă nimic — dar nici nu strică. Redundant.');
} else {
  console.log(`✗ Stackingul CU piață e mai prost decât piața cu ${Math.abs(gain).toFixed(2)}%.`);
  console.log('  Modelul degradează informația pieței.');
}
const stackNo = evalSet(results['stacking fără piață']);
const fixed = evalSet(results['blend fix (referință)']);
const vsFixed = ((fixed.rps - stackNo.rps) / fixed.rps) * 100;
console.log(`\nStacking vs blend fix (fără piață): ${vsFixed >= 0 ? '+' : ''}${vsFixed.toFixed(2)}%`);
console.log(vsFixed > 0.5
  ? '  Meta-learnerul chiar îmbunătățește combinarea modelelor.'
  : '  Meta-learnerul nu bate o medie ponderată fixă — modelele sunt prea corelate.');
console.log();
