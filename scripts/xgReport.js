#!/usr/bin/env node
/**
 * Același raport ca `stackingReport.js`, plus xG ca sursă.
 *
 * Ipoteza: golurile sunt un semnal zgomotos al performanței, iar un
 * Dixon-Coles antrenat pe xG ar trebui să estimeze forța echipelor mai stabil.
 * Dacă e adevărat, „stacking CU piață" ar trebui să bată piața singură.
 *
 * Sursa de xG: FPL istoric (vaastav/Fantasy-Premier-League), agregat pe echipă
 * și meci. Doar Premier League, din 2022/23 — atât e disponibil gratuit după
 * ce Understat a închis accesul programatic.
 *
 *   node scripts/xgReport.js
 */
import { loadMainSeasons } from '../src/lib/footballData.js';
import { loadXgSeasons, joinKey } from '../src/lib/xgData.js';
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { buildRatings, predictElo } from '../src/models/elo.js';
import { simulate } from '../src/models/monteCarlo.js';
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
const WINDOW = Number(args.window ?? 760);
const META_MIN = Number(args['meta-min'] ?? 300);
const TRAIN_MIN = Number(args['train-min'] ?? 380);
const SIMS = Number(args.simulations ?? 3000);
const CLASS_OF = { '1': 0, X: 1, '2': 2 };
const norm = (s) => { const t = s.home_win + s.draw + s.away_win; return [s.home_win / t, s.draw / t, s.away_win / t]; };

/* ---------- lipirea surselor ---------- */

console.error('Încarc cotele (football-data.co.uk)...');
const odds = await loadMainSeasons('E0', ['2223', '2324', '2425', '2526']);
console.error(`  ${odds.length} meciuri cu rezultat`);

console.error('Încarc xG (FPL istoric)...');
const xg = await loadXgSeasons();
console.error(`  ${xg.length} meciuri cu xG`);

const xgByKey = new Map(xg.map((m) => [joinKey(m.date, m.home, m.away), m]));
const matches = [];
let matched = 0;
for (const o of odds) {
  if (!o.closingOdds) continue;
  const k = joinKey(o.date, o.home, o.away);
  const x = xgByKey.get(k);
  if (x) matched++;
  matches.push({ ...o, xgHome: x?.xgHome ?? null, xgAway: x?.xgAway ?? null });
}
matches.sort((a, b) => a.date.localeCompare(b.date));
console.error(`\nLipite: ${matched}/${matches.length} meciuri au și cote și xG\n`);
if (matched < 500) {
  console.error('Prea puține potriviri — verifică normalizarea numelor de echipă.');
  const missed = matches.filter((m) => m.xgHome === null).slice(0, 8).map((m) => `${m.date} ${m.home}–${m.away}`);
  console.error('Exemple nelipite:', missed);
}

/* ---------- predicțiile de bază, inclusiv varianta pe xG ---------- */

const samples = [];
for (let i = TRAIN_MIN; i < matches.length; i++) {
  const t = matches[i];
  const history = matches.slice(Math.max(0, i - WINDOW), i);
  if (history.length < 200) continue;
  const market = closingProbs(t.closingOdds);
  if (!market) continue;

  const sources = {};

  // Dixon-Coles pe GOLURI.
  try {
    const fit = fitDixonColes(history, { referenceDate: t.date });
    lambdasFromFit(fit, t.home, t.away);
    const dc = predictDixonColes({ fit, home: t.home, away: t.away });
    sources.dixonColes = norm(dc);
    sources.monteCarlo = norm(simulate(dc.matrix, { simulations: SIMS, seed: i }));
  } catch { continue; }

  // Dixon-Coles pe xG: aceleași ecuații, dar „golurile" sunt xG rotunjit.
  // Rotunjirea e necesară fiindcă modelul e discret — se pierde puțin din
  // informație, dar semnalul de bază (câte ocazii creează echipa) rămâne.
  const xgHistory = history
    .filter((m) => m.xgHome !== null && m.xgAway !== null)
    .map((m) => ({
      home: m.home, away: m.away, date: m.date,
      homeGoals: Math.round(m.xgHome), awayGoals: Math.round(m.xgAway),
    }));
  if (xgHistory.length >= 150) {
    try {
      const fitX = fitDixonColes(xgHistory, { referenceDate: t.date });
      lambdasFromFit(fitX, t.home, t.away);
      const dcx = predictDixonColes({ fit: fitX, home: t.home, away: t.away });
      sources.dixonColesXg = norm(dcx);
    } catch { /* echipă fără istoric xG */ }
  }

  const ratings = buildRatings(history);
  if (Number.isFinite(ratings[t.home]) && Number.isFinite(ratings[t.away])) {
    sources.elo = norm(predictElo({ ratingHome: ratings[t.home], ratingAway: ratings[t.away] }));
  }

  samples.push({
    date: t.date, outcome: t.outcome, label: CLASS_OF[t.outcome],
    sources, market, hasXg: Boolean(sources.dixonColesXg),
    extra: { elo_diff: ((ratings[t.home] ?? 1500) - (ratings[t.away] ?? 1500)) / 100 },
  });
}
console.error(`${samples.length} meciuri evaluabile, ${samples.filter((s) => s.hasXg).length} cu sursă xG\n`);
if (samples.length < META_MIN + 100) { console.error('Prea puține.'); process.exit(1); }

/* ---------- walk-forward pe meta-learner ---------- */

const BASE = ['dixonColes', 'monteCarlo', 'elo'];
const variants = {
  'piață singură': null,
  'stacking fără piață': { sourceNames: BASE },
  'stacking + xG, fără piață': { sourceNames: [...BASE, 'dixonColesXg'] },
  'stacking CU piață': { sourceNames: [...BASE, 'market'] },
  'stacking + xG CU piață': { sourceNames: [...BASE, 'dixonColesXg', 'market'] },
  'doar piața ca feature': { sourceNames: ['market'] },
};
const results = Object.fromEntries(Object.keys(variants).map((k) => [k, []]));
const RETRAIN = Number(args['retrain-every'] ?? 50);
const trained = {};

for (let i = META_MIN; i < samples.length; i++) {
  const s = samples[i];
  if ((i - META_MIN) % RETRAIN === 0) {
    const past = samples.slice(0, i);
    const labels = past.map((p) => p.label);
    const rows = past.map((p) => ({ sources: { ...p.sources, market: p.market }, extra: p.extra }));
    for (const [name, cfg] of Object.entries(variants)) {
      if (!cfg) continue;
      trained[name] = trainStack(rows, labels, { ...cfg, extraNames: ['elo_diff'], iterations: 250, l2: 2.0 });
    }
  }
  const row = { sources: { ...s.sources, market: s.market }, extra: s.extra };
  results['piață singură'].push({ p: s.market, outcome: s.outcome });
  for (const [name, cfg] of Object.entries(variants)) {
    if (!cfg) continue;
    results[name].push({ p: trained[name].predict(row), outcome: s.outcome });
  }
}

/* ---------- raport ---------- */

const evalSet = (rows) => {
  const n = rows.length;
  return {
    n,
    rps: rows.reduce((a, r) => a + rps(r.p, r.outcome), 0) / n,
    logloss: rows.reduce((a, r) => a + logLoss(r.p, r.outcome), 0) / n,
    acc: rows.filter((r) => ['1', 'X', '2'][r.p.indexOf(Math.max(...r.p))] === r.outcome).length / n * 100,
  };
};

console.log(`\n${'═'.repeat(88)}`);
console.log(`xG ÎN STACKING — Premier League, ${results['piață singură'].length} meciuri OOS, walk-forward`);
console.log('═'.repeat(88));
console.log('variantă'.padEnd(30) + 'RPS'.padStart(10) + 'log-loss'.padStart(11) + 'acuratețe'.padStart(11) + 'vs piață'.padStart(12));
console.log('─'.repeat(88));
const market = evalSet(results['piață singură']);
for (const name of Object.keys(variants)) {
  const e = evalSet(results[name]);
  const d = ((market.rps - e.rps) / market.rps) * 100;
  console.log(
    name.padEnd(30) + e.rps.toFixed(5).padStart(10) + e.logloss.toFixed(4).padStart(11) +
    `${e.acc.toFixed(1)}%`.padStart(11) +
    (name === 'piață singură' ? '—'.padStart(12) : `${d >= 0 ? '+' : ''}${d.toFixed(2)}%`.padStart(12))
  );
}
console.log('─'.repeat(88));

const withXg = evalSet(results['stacking + xG CU piață']);
const noXg = evalSet(results['stacking CU piață']);
const gainMarket = ((market.rps - withXg.rps) / market.rps) * 100;
const gainXg = ((noXg.rps - withXg.rps) / noXg.rps) * 100;
console.log(`\nxG adaugă peste stackingul cu piață: ${gainXg >= 0 ? '+' : ''}${gainXg.toFixed(2)}%`);
console.log(`Stacking + xG vs piață singură:      ${gainMarket >= 0 ? '+' : ''}${gainMarket.toFixed(2)}%`);
console.log();
console.log(gainMarket > 0.5
  ? '✓ Cu xG, modelul BATE piața. Prima dovadă de informație independentă.'
  : gainMarket > -0.5
    ? '~ Nici cu xG modelul nu bate piața. Redundant, dar nu dăunător.'
    : '✗ Nici cu xG. Modelul degradează informația pieței.');
console.log();
