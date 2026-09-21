#!/usr/bin/env node
/**
 * Backtest: rulează botul pe meciuri DEJA terminate și compară predicția cu
 * rezultatul real. Sursa de adevăr sunt meciurile FINISHED din PredictCamp.
 *
 * Notă importantă: endpoint-ul /models e disponibil DOAR înainte de start
 * (422 MODELS_NOT_AVAILABLE după). Backtest-ul funcționează așadar pe
 * predicțiile salvate anterior de crawler (data/predictions/*.jsonl), nu
 * recalculând retroactiv modele. Pentru un backtest pur istoric folosește
 * --refit, care estimează Dixon-Coles local din rezultatele anterioare.
 *
 *   node scripts/backtest.js --limit=100 [--league=PL] [--refit]
 */
import { listMatches, getMatch, extractOdds } from '../src/dataFetcher.js';
import { devig } from '../src/betting/odds.js';
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { simulate } from '../src/models/monteCarlo.js';
import { selectionHit } from '../src/lib/accuracy.js';
import { loadPredictions } from '../src/lib/store.js';

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    args[k] = v === undefined ? true : v;
  }
  return args;
}

/** Brier score multiclass pentru 1X2 — cu cât mai mic, cu atât mai bine calibrat. */
function brier(probs, outcome) {
  const actual = { '1': [1, 0, 0], X: [0, 1, 0], '2': [0, 0, 1] }[outcome];
  return probs.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0);
}

/** Ranked Probability Score — metrica standard pentru rezultate ordonate (1/X/2). */
function rps(probs, outcome) {
  const actual = { '1': [1, 0, 0], X: [0, 1, 0], '2': [0, 0, 1] }[outcome];
  let cumP = 0, cumA = 0, sum = 0;
  for (let i = 0; i < probs.length - 1; i++) {
    cumP += probs[i]; cumA += actual[i];
    sum += (cumP - cumA) ** 2;
  }
  return sum / (probs.length - 1);
}

/** Backtest peste predicțiile salvate, soluționate cu rezultatele reale. */
async function backtestStored({ limit }) {
  const stored = await loadPredictions();
  const bets = stored.filter((p) => p.selection && p.result);
  console.log(`Predicții salvate: ${stored.length}, soluționate: ${bets.length}`);
  if (!bets.length) {
    console.log('Nimic de evaluat. Rulează întâi crawler-ul, apoi `npm run settle`.');
    return;
  }
  let wins = 0, brierSum = 0, rpsSum = 0, profit = 0;
  for (const p of bets.slice(0, limit)) {
    const hit = selectionHit(p.selection, p.result.score_home, p.result.score_away);
    if (hit) wins++;
    const outcome = p.result.score_home > p.result.score_away ? '1'
      : p.result.score_home === p.result.score_away ? 'X' : '2';
    const probs = [p.probabilities.home_win_pct, p.probabilities.draw_pct, p.probabilities.away_win_pct].map((x) => x / 100);
    brierSum += brier(probs, outcome);
    rpsSum += rps(probs, outcome);
    const odds = p.candidates?.find((c) => c.selection === p.selection)?.book_odds;
    if (odds) profit += hit ? odds - 1 : -1;
  }
  const n = Math.min(bets.length, limit ?? bets.length);
  console.log(`\nAcuratețe: ${((wins / n) * 100).toFixed(1)}% (${wins}/${n})`);
  console.log(`Brier (1X2): ${(brierSum / n).toFixed(4)}  — baseline naiv ~0.63`);
  console.log(`RPS:         ${(rpsSum / n).toFixed(4)}  — baseline naiv ~0.23`);
  console.log(`ROI flat 1u: ${((profit / n) * 100).toFixed(1)}%`);
}

/**
 * Backtest walk-forward: refit Dixon-Coles pe trecut, predicție pe meciul următor.
 *
 * `from`/`to` sunt OBLIGATORII în practică: fără ele, /matches aplică o fereastră
 * implicită îngustă și întoarce o mână de meciuri, nu istoricul.
 */
async function backtestRefit({ limit = 200, league, from, to, minTrain: minTrainArg, withMarket = false }) {
  if (!from || !to) {
    throw new Error('backtestRefit: --from și --to sunt obligatorii (altfel API-ul întoarce doar fereastra recentă)');
  }
  const finished = await listMatches({ status: 'FINISHED', league, from, to, limit: Math.max(limit * 4, 600) });
  const usable = finished
    .filter((m) => Number.isFinite(m.score_home) && Number.isFinite(m.score_away))
    .map((m) => ({
      home: m.home_team, away: m.away_team,
      homeGoals: m.score_home, awayGoals: m.score_away,
      date: m.match_date, slug: m.slug,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  console.log(`Meciuri terminate disponibile: ${usable.length}`);
  const minTrain = minTrainArg ?? Math.max(60, Math.floor(usable.length * 0.5));
  if (usable.length < minTrain + 10) {
    console.log('Prea puține meciuri pentru walk-forward. Mărește --limit sau scoate --league.');
    return;
  }

  let n = 0, wins = 0, brierSum = 0, rpsSum = 0;
  // Baseline: „mereu gazdele" — cel mai simplu predictor posibil.
  let homeAlways = 0;
  const outcomes = { '1': 0, X: 0, '2': 0 };
  // Baseline uniform, acumulat pe ACELEAȘI meciuri: Brier e constant (2/3), dar
  // RPS depinde de rezultat (egalul se penalizează mai puțin decât 1 sau 2),
  // deci nu poate fi o constantă — trebuie mediat pe rezultatele efective.
  const UNIFORM = [1 / 3, 1 / 3, 1 / 3];
  let uniformBrierSum = 0, uniformRpsSum = 0;
  // Baseline „rata de bază": frecvențele 1/X/2 din setul de antrenare. E
  // reperul naiv corect — uniform (1/3) e prea slab, nimeni nu prezice așa.
  let baseRateRpsSum = 0, baseRateBrierSum = 0;
  // Piața: cotele istorice de-vigate. Reperul real pentru pariuri.
  let marketN = 0, marketRpsSum = 0, marketBrierSum = 0;
  let modelRpsOnMarketSet = 0, modelBrierOnMarketSet = 0, marketWins = 0, modelWinsOnMarketSet = 0;
  for (let i = minTrain; i < usable.length && n < limit; i++) {
    const train = usable.slice(0, i);
    const target = usable[i];
    let fit;
    try {
      fit = fitDixonColes(train, { referenceDate: target.date });
      lambdasFromFit(fit, target.home, target.away);
    } catch { continue; } // echipă nevăzută încă în setul de antrenare
    const pred = predictDixonColes({ fit, home: target.home, away: target.away });
    const sim = simulate(pred.matrix, { simulations: 5000, seed: i });
    const probs = [sim.home_win, sim.draw, sim.away_win];
    const outcome = target.homeGoals > target.awayGoals ? '1'
      : target.homeGoals === target.awayGoals ? 'X' : '2';
    // Rata de bază se calculează DOAR din trecut, ca să nu existe leakage.
    let bh = 0, bd = 0;
    for (const m of train) {
      if (m.homeGoals > m.awayGoals) bh++; else if (m.homeGoals === m.awayGoals) bd++;
    }
    const baseRate = [bh / train.length, bd / train.length, 1 - bh / train.length - bd / train.length];

    const picked = ['1', 'X', '2'][probs.indexOf(Math.max(...probs))];
    if (picked === outcome) wins++;
    if (outcome === '1') homeAlways++;
    outcomes[outcome]++;
    brierSum += brier(probs, outcome);
    rpsSum += rps(probs, outcome);
    uniformBrierSum += brier(UNIFORM, outcome);
    uniformRpsSum += rps(UNIFORM, outcome);
    baseRateBrierSum += brier(baseRate, outcome);
    baseRateRpsSum += rps(baseRate, outcome);
    n++;

    if (withMarket) {
      try {
        const full = await getMatch(target.slug);
        const od = extractOdds(full);
        if (od) {
          const fair = devig(od.odds['1x2'], { method: 'shin' }).fair_probabilities;
          marketRpsSum += rps(fair, outcome);
          marketBrierSum += brier(fair, outcome);
          modelRpsOnMarketSet += rps(probs, outcome);
          modelBrierOnMarketSet += brier(probs, outcome);
          const marketPick = ['1', 'X', '2'][fair.indexOf(Math.max(...fair))];
          if (marketPick === outcome) marketWins++;
          if (picked === outcome) modelWinsOnMarketSet++;
          marketN++;
        }
      } catch { /* meci fără cote istorice — se sare */ }
    }
  }

  if (!n) { console.log('Niciun meci evaluabil.'); return; }
  console.log(`\nWalk-forward pe ${n} meciuri (antrenare ≥ ${minTrain}):`);
  const uniformBrier = uniformBrierSum / n;
  const uniformRps = uniformRpsSum / n;
  console.log(`Distribuție reală: 1 ${outcomes['1']} / X ${outcomes.X} / 2 ${outcomes['2']}`);
  console.log('');
  console.log(`Acuratețe model:   ${((wins / n) * 100).toFixed(1)}%`);
  console.log(`Acuratețe „mereu 1": ${((homeAlways / n) * 100).toFixed(1)}%  ← baseline de bătut`);
  console.log('');
  console.log(`Brier model:    ${(brierSum / n).toFixed(4)}   (uniform: ${uniformBrier.toFixed(4)}; mai mic = mai bun)`);
  console.log(`RPS model:      ${(rpsSum / n).toFixed(4)}   (uniform: ${uniformRps.toFixed(4)}; mai mic = mai bun)`);
  const baseRateRps = baseRateRpsSum / n;
  const baseRateBrier = baseRateBrierSum / n;
  console.log(`Brier rată de bază: ${baseRateBrier.toFixed(4)}`);
  console.log(`RPS   rată de bază: ${baseRateRps.toFixed(4)}   ← reperul naiv corect`);
  console.log('');
  const gainUniform = ((uniformRps - rpsSum / n) / uniformRps) * 100;
  const gainBase = ((baseRateRps - rpsSum / n) / baseRateRps) * 100;
  console.log(`Câștig RPS vs uniform:      ${gainUniform.toFixed(1)}%`);
  console.log(`Câștig RPS vs rată de bază: ${gainBase.toFixed(1)}%   ← cifra care contează`);

  if (withMarket && marketN > 0) {
    console.log('');
    console.log(`--- vs PIAȚĂ (${marketN} meciuri cu cote istorice de-vigate) ---`);
    const mRps = marketRpsSum / marketN, mBrier = marketBrierSum / marketN;
    const modRps = modelRpsOnMarketSet / marketN, modBrier = modelBrierOnMarketSet / marketN;
    console.log(`RPS   model ${modRps.toFixed(4)}  vs  piață ${mRps.toFixed(4)}`);
    console.log(`Brier model ${modBrier.toFixed(4)}  vs  piață ${mBrier.toFixed(4)}`);
    console.log(`Acuratețe model ${((modelWinsOnMarketSet / marketN) * 100).toFixed(1)}%  vs  piață ${((marketWins / marketN) * 100).toFixed(1)}%`);
    const delta = ((mRps - modRps) / mRps) * 100;
    console.log(delta > 0
      ? `Modelul e cu ${delta.toFixed(1)}% MAI BUN decât piața (suspect — verifică dacă cotele sunt pre-kickoff)`
      : `Modelul e cu ${Math.abs(delta).toFixed(1)}% mai slab decât piața (normal)`);
  } else if (withMarket) {
    console.log('\nNiciun meci din set n-a avut cote istorice.');
  }
}

export { brier, rps, backtestStored, backtestRefit };

// Rulează doar când e invocat direct, nu la import (testele importă metricile).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  const limit = args.limit ? Number(args.limit) : 200;
  (args.refit
    ? backtestRefit({
        limit, league: args.league, from: args.from, to: args.to,
        minTrain: args['min-train'] ? Number(args['min-train']) : undefined,
        withMarket: Boolean(args.market),
      })
    : backtestStored({ limit }))
    .catch((err) => { console.error('Backtest eșuat:', err.message); process.exitCode = 1; });
}
