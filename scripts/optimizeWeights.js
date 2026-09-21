#!/usr/bin/env node
/**
 * Optimizează ponderile de ensemble pe date, cu train/test pe ligi separate.
 *
 * Ponderile actuale au fost alese din intuiție. Întrebarea: se poate mai bine,
 * și se generalizează îmbunătățirea la ligi pe care optimizarea nu le-a văzut?
 *
 *   node scripts/optimizeWeights.js --from=2025-08-01 --to=2026-06-30 \
 *        --train=PL,PD,SA --test=BL1,FL1
 *
 * Obiectivul e RPS (regulă de scor proprie) — nu acuratețea, care ignoră
 * calitatea probabilităților, și nu ROI-ul, care e prea zgomotos ca să
 * optimizezi pe el la eșantionul ăsta.
 */
import { listMatches, extractOdds } from '../src/dataFetcher.js';
import { replaySources } from '../src/bot/replay.js';
import { blend } from '../src/models/ensemble.js';
import { personalities } from '../src/bot/personalities.js';
import { rps, brier } from './backtest.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
if (!args.from || !args.to) { console.error('--from și --to obligatorii'); process.exit(1); }

const trainLeagues = (args.train ?? 'PL,PD,SA').split(',').map((s) => s.trim());
const testLeagues = (args.test ?? 'BL1,FL1').split(',').map((s) => s.trim());
const simulations = Number(args.simulations ?? 3000);
const SOURCES = ['dixonColes', 'monteCarlo', 'poisson', 'elo'];

async function load(league) {
  const rows = await listMatches({ status: 'FINISHED', league, from: args.from, to: args.to, limit: 800 });
  return rows
    .filter((m) => Number.isFinite(m.score_home) && Number.isFinite(m.score_away))
    .map((m) => ({
      slug: m.slug, home: m.home_team, away: m.away_team, league,
      homeGoals: m.score_home, awayGoals: m.score_away, date: m.match_date,
      odds: extractOdds(m)?.odds?.['1x2'] ?? null,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/** Precalculează sursele pentru toate meciurile de test dintr-o ligă. */
async function prepare(leagues) {
  const out = [];
  for (const league of leagues) {
    const all = await load(league);
    const minTrain = Number(args['min-train'] ?? Math.max(80, Math.floor(all.length * 0.45)));
    if (all.length < minTrain + 20) { console.error(`${league}: prea puține meciuri`); continue; }
    let n = 0;
    for (let i = minTrain; i < all.length; i++) {
      const sources = replaySources({ history: all.slice(0, i), target: all[i], simulations, seed: i });
      if (!sources) continue;
      const t = all[i];
      out.push({
        league,
        outcome: t.homeGoals > t.awayGoals ? '1' : t.homeGoals === t.awayGoals ? 'X' : '2',
        odds: t.odds,
        probsBySource: Object.fromEntries(Object.entries(sources).map(([k, v]) => {
          const tot = v.home_win + v.draw + v.away_win;
          return [k, [v.home_win / tot, v.draw / tot, v.away_win / tot]];
        })),
      });
      n++;
    }
    console.error(`${league}: ${n} meciuri pregătite`);
  }
  return out;
}

/** RPS mediu pentru un set de ponderi. */
function scoreWeights(rows, weights) {
  let sum = 0, n = 0;
  for (const r of rows) {
    let acc = [0, 0, 0], wsum = 0;
    for (const [src, w] of Object.entries(weights)) {
      const p = r.probsBySource[src];
      if (!p || !(w > 0)) continue;
      for (let i = 0; i < 3; i++) acc[i] += w * p[i];
      wsum += w;
    }
    if (!wsum) continue;
    acc = acc.map((x) => x / wsum);
    sum += rps(acc, r.outcome);
    n++;
  }
  return n ? sum / n : Infinity;
}

const train = await prepare(trainLeagues);
const test = await prepare(testLeagues);
if (!train.length || !test.length) { console.error('Date insuficiente.'); process.exit(1); }

// Căutare aleatoare pe simplex (Dirichlet uniform), plus vârfurile pure.
const N = Number(args.iterations ?? 4000);
let rng = 12345;
const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

const candidates = [];
// Vârfurile: fiecare sursă singură, ca referință.
for (const s of SOURCES) candidates.push(Object.fromEntries(SOURCES.map((k) => [k, k === s ? 1 : 0])));
// Uniform.
candidates.push(Object.fromEntries(SOURCES.map((k) => [k, 0.25])));
// Ponderile actuale ale fiecărei personalități, filtrate la sursele replayabile.
for (const [id, p] of Object.entries(personalities)) {
  const w = Object.fromEntries(SOURCES.map((k) => [k, p.weights[k] ?? 0]));
  if (Object.values(w).some((x) => x > 0)) candidates.push({ ...w, __label: id });
}
// Căutare aleatoare.
for (let i = 0; i < N; i++) {
  const raw = SOURCES.map(() => -Math.log(1 - rand()));
  const tot = raw.reduce((a, b) => a + b, 0);
  candidates.push(Object.fromEntries(SOURCES.map((k, j) => [k, raw[j] / tot])));
}

const scored = candidates.map((w) => {
  const { __label, ...weights } = w;
  return { weights, label: __label ?? null, trainRps: scoreWeights(train, weights) };
}).sort((a, b) => a.trainRps - b.trainRps);

const best = scored[0];
const current = scored.find((s) => s.label === 'ai-analyst');
const uniform = scored.find((s) => SOURCES.every((k) => Math.abs(s.weights[k] - 0.25) < 1e-9));

const fmt = (w) => SOURCES.map((k) => `${k.slice(0, 2)}:${w[k].toFixed(2)}`).join(' ');
const line = (name, s) => {
  const testRps = scoreWeights(test, s.weights);
  console.log(
    name.padEnd(22) + fmt(s.weights).padEnd(34) +
    s.trainRps.toFixed(5).padStart(10) + testRps.toFixed(5).padStart(11)
  );
  return testRps;
};

console.log(`\n=== Optimizare ponderi — antrenare ${trainLeagues.join('/')} (${train.length}), test ${testLeagues.join('/')} (${test.length}) ===\n`);
console.log('variantă'.padEnd(22) + 'ponderi'.padEnd(34) + 'RPS train'.padStart(10) + 'RPS test'.padStart(11));
const bestTest = line('optim pe train', best);
const currentTest = current ? line('actual (ai-analyst)', current) : null;
if (uniform) line('uniform', uniform);
for (const s of SOURCES) {
  const pure = scored.find((x) => x.weights[s] === 1);
  if (pure) line(`doar ${s}`, pure);
}

console.log('');
if (current) {
  const gainTrain = ((current.trainRps - best.trainRps) / current.trainRps) * 100;
  const gainTest = ((currentTest - bestTest) / currentTest) * 100;
  console.log(`Câștig pe ANTRENARE: ${gainTrain.toFixed(2)}%`);
  console.log(`Câștig pe TEST:      ${gainTest.toFixed(2)}%   ← singura cifră care contează`);
  console.log('');
  if (gainTest < 0.5) {
    console.log('Îmbunătățirea NU se generalizează. Ponderile actuale sunt suficient de bune;');
    console.log('diferența pe antrenare e zgomot învățat, nu semnal.');
  } else {
    console.log('Îmbunătățirea se generalizează. Merită adoptate ponderile noi.');
  }
}
console.log('');
