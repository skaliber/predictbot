#!/usr/bin/env node
/**
 * Două experimente care pot schimba fundamental calitatea predicțiilor.
 *
 * A. FEREASTRA DE ANTRENARE
 *    Backtestul inițial antrena pe ~jumătate de sezon (80–190 meciuri).
 *    Dixon-Coles se estimează în mod normal pe 2+ sezoane. Cât pierdem?
 *
 *      node scripts/experiments.js --experiment=window --league=PL
 *
 * B. ADUCE MODELUL CEVA PESTE PIAȚĂ?
 *    Întrebarea decisivă. Dacă amestecăm probabilitatea de model cu cea a
 *    pieței (de-vigată) și amestecul bate piața pură, atunci modelul CHIAR are
 *    informație independentă — doar că nu destulă ca să acopere marja singur.
 *    Dacă niciun amestec nu bate piața, modelul e pur și simplu redundant.
 *
 *      node scripts/experiments.js --experiment=blend --train=PL,PD,SA --test=BL1,FL1
 */
import { listMatches, extractOdds } from '../src/dataFetcher.js';
import { replaySources } from '../src/bot/replay.js';
import { blend } from '../src/models/ensemble.js';
import { devig } from '../src/betting/odds.js';
import { personalities } from '../src/bot/personalities.js';
import { rps } from './backtest.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
const WEIGHTS = personalities['ai-analyst'].weights;
const simulations = Number(args.simulations ?? 3000);

/** Limita trebuie să acopere TOT intervalul: altfel primim un subset arbitrar. */
async function load(league, from, to, limit = 3000) {
  const rows = await listMatches({ status: 'FINISHED', league, from, to, limit });
  return rows
    .filter((m) => Number.isFinite(m.score_home) && Number.isFinite(m.score_away))
    .map((m) => ({
      home: m.home_team, away: m.away_team, league,
      homeGoals: m.score_home, awayGoals: m.score_away, date: m.match_date,
      odds: extractOdds(m)?.odds?.['1x2'] ?? null,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const outcomeOf = (m) => (m.homeGoals > m.awayGoals ? '1' : m.homeGoals === m.awayGoals ? 'X' : '2');

/** Probabilitățile ensemble pentru un meci, dintr-o fereastră de istoric dată. */
function modelProbs(history, target, seed) {
  const sources = replaySources({ history, target, simulations, seed });
  if (!sources) return null;
  const e = blend(sources, WEIGHTS);
  const tot = e.home_win + e.draw + e.away_win;
  return [e.home_win / tot, e.draw / tot, e.away_win / tot];
}

/* ---------- A. fereastra de antrenare ---------- */

async function experimentWindow() {
  const league = args.league ?? 'PL';
  // Tot istoricul disponibil, apoi testăm pe ultimul sezon.
  const all = await load(league, '2021-08-01', '2026-06-30');
  const testFrom = new Date(args['test-from'] ?? '2025-11-01');
  const testIdx = all.findIndex((m) => new Date(m.date) >= testFrom);
  if (testIdx < 0) { console.error('Nu există set de test.'); return; }
  const testSet = all.slice(testIdx);
  console.error(`${league}: ${all.length} meciuri total, ${testSet.length} în test (de la ${testFrom.toISOString().slice(0, 10)})`);

  // Ferestre exprimate în meciuri (un sezon de ligă mare ≈ 380).
  const windows = [190, 380, 760, 1140, Infinity];
  const results = [];
  for (const w of windows) {
    let sum = 0, n = 0;
    for (let i = 0; i < testSet.length; i++) {
      const globalIdx = testIdx + i;
      const from = Number.isFinite(w) ? Math.max(0, globalIdx - w) : 0;
      const history = all.slice(from, globalIdx);
      if (history.length < 60) continue;
      const p = modelProbs(history, testSet[i], globalIdx);
      if (!p) continue;
      sum += rps(p, outcomeOf(testSet[i]));
      n++;
    }
    const label = Number.isFinite(w) ? `${w} meciuri (~${(w / 380).toFixed(1)} sezoane)` : 'tot istoricul';
    results.push({ label, window: w, rps: sum / n, n });
    console.error(`  ${label}: ${n} evaluate`);
  }

  console.log(`\n=== A. Fereastra de antrenare — ${league}, ${results[0].n} meciuri de test ===\n`);
  console.log('fereastră'.padEnd(30) + 'RPS'.padStart(10) + 'vs cea mai scurtă'.padStart(20));
  const baseline = results[0].rps;
  for (const r of results) {
    const gain = ((baseline - r.rps) / baseline) * 100;
    console.log(r.label.padEnd(30) + r.rps.toFixed(5).padStart(10) + `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%`.padStart(20));
  }
  const best = results.reduce((a, b) => (b.rps < a.rps ? b : a));
  console.log(`\nCea mai bună: ${best.label}`);
  console.log(best.window > 190
    ? 'Antrenarea pe jumătate de sezon PIERDE informație reală. Merită mărită fereastra.'
    : 'Fereastra scurtă e suficientă — forma recentă bate volumul de date.');
  console.log('');
}

/* ---------- B. aduce modelul ceva peste piață? ---------- */

async function experimentBlend() {
  const trainLeagues = (args.train ?? 'PL,PD,SA').split(',').map((s) => s.trim());
  const testLeagues = (args.test ?? 'BL1,FL1').split(',').map((s) => s.trim());
  const window = Number(args.window ?? 760);

  async function prepare(leagues) {
    const out = [];
    for (const league of leagues) {
      const all = await load(league, '2021-08-01', '2026-06-30');
      const testFrom = new Date(args['test-from'] ?? '2025-11-01');
      const testIdx = all.findIndex((m) => new Date(m.date) >= testFrom);
      if (testIdx < 0) continue;
      let n = 0;
      for (let i = testIdx; i < all.length; i++) {
        const t = all[i];
        if (!t.odds) continue;
        const history = all.slice(Math.max(0, i - window), i);
        if (history.length < 60) continue;
        const model = modelProbs(history, t, i);
        if (!model) continue;
        const market = devig(t.odds, { method: 'shin' }).fair_probabilities;
        out.push({ league, model, market, outcome: outcomeOf(t) });
        n++;
      }
      console.error(`  ${league}: ${n} meciuri cu cote`);
    }
    return out;
  }

  console.error('Pregătesc antrenarea...');
  const train = await prepare(trainLeagues);
  console.error('Pregătesc testul...');
  const test = await prepare(testLeagues);
  if (!train.length || !test.length) { console.error('Date insuficiente.'); return; }

  const scoreLambda = (rows, lambda) => {
    let s = 0;
    for (const r of rows) {
      const p = r.market.map((m, i) => (1 - lambda) * m + lambda * r.model[i]);
      const tot = p.reduce((a, b) => a + b, 0);
      s += rps(p.map((x) => x / tot), r.outcome);
    }
    return s / rows.length;
  };

  const lambdas = Array.from({ length: 21 }, (_, i) => i / 20);
  const trainScores = lambdas.map((l) => ({ lambda: l, rps: scoreLambda(train, l) }));
  const bestTrain = trainScores.reduce((a, b) => (b.rps < a.rps ? b : a));

  console.log(`\n=== B. Aduce modelul ceva peste piață? ===`);
  console.log(`Antrenare: ${trainLeagues.join('/')} (${train.length}) · Test: ${testLeagues.join('/')} (${test.length})\n`);
  console.log('amestec'.padEnd(26) + 'RPS train'.padStart(11) + 'RPS test'.padStart(11));
  for (const l of [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1]) {
    const label = l === 0 ? 'doar piața' : l === 1 ? 'doar modelul' : `${Math.round((1 - l) * 100)}% piață + ${Math.round(l * 100)}% model`;
    console.log(label.padEnd(26) + scoreLambda(train, l).toFixed(5).padStart(11) + scoreLambda(test, l).toFixed(5).padStart(11));
  }

  const marketTest = scoreLambda(test, 0);
  const bestTest = scoreLambda(test, bestTrain.lambda);
  const gain = ((marketTest - bestTest) / marketTest) * 100;
  console.log(`\nAmestecul optim pe antrenare: ${Math.round(bestTrain.lambda * 100)}% model`);
  console.log(`Pe TEST: ${bestTest.toFixed(5)} vs piața pură ${marketTest.toFixed(5)}  →  ${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%`);
  console.log('');
  if (gain > 0.3) {
    console.log('✓ Modelul ADUCE informație pe care piața nu o are.');
    console.log('  Amestecat cu piața, prezice mai bine decât piața singură.');
  } else if (gain > -0.3) {
    console.log('~ Modelul e în esență redundant: nu strică, dar nici nu adaugă.');
  } else {
    console.log('✗ Modelul STRICĂ predicția pieței. Orice amestec e mai prost decât piața pură.');
  }
  console.log('');
}

const exp = args.experiment ?? 'window';
if (exp === 'window') await experimentWindow();
else if (exp === 'blend') await experimentBlend();
else { console.error('--experiment=window|blend'); process.exit(1); }
