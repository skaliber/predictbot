#!/usr/bin/env node
/**
 * Trei întrebări pe care celelalte rapoarte nu le-au atins:
 *
 *  A. DUBLĂ ȘANSĂ — modelul zice „1", dar joci 1X. Cotă mică, certitudine
 *     mare. Chiar iese mai bine?
 *  B. BILETE COMBINATE — 3-4 meciuri cu certitudine bună la cote mici.
 *     Cumulat aduc valoare, sau marja se compune?
 *  C. MIȘCAREA LINIEI — urmărești banii, nu modelul. Partea spre care s-a
 *     mutat piața între deschidere și închidere prezice rezultatul?
 *
 * Totul walk-forward, point-in-time, pe cote reale.
 *
 *   node scripts/combinedReport.js --main=E0,E1,I1,SP1,D1,N1 --seasons=2021,2122,2223,2324,2425
 */
import { loadMainSeasons } from '../src/lib/footballData.js';
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { buildRatings, predictElo } from '../src/models/elo.js';
import { simulate } from '../src/models/monteCarlo.js';
import { blend } from '../src/models/ensemble.js';
import { closingProbs } from '../src/lib/clv.js';
import { doubleChanceOdds, doubleChanceHit, accumulator, theoreticalAccumulatorRoi, lineMove } from '../src/lib/combinedMarkets.js';
import { bootstrapRoi } from '../src/lib/clv.js';
import { flatRoi } from '../src/lib/hypothesis.js';

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
const SIMS = Number(args.simulations ?? 3000);
const WEIGHTS = { dixonColes: 0.4, monteCarlo: 0.2, elo: 0.4 };

function forecast(history, target, seed) {
  let fit;
  try {
    fit = fitDixonColes(history, { referenceDate: target.date });
    lambdasFromFit(fit, target.home, target.away);
  } catch { return null; }
  const dc = predictDixonColes({ fit, home: target.home, away: target.away });
  const mc = simulate(dc.matrix, { simulations: SIMS, seed });
  const sources = { dixonColes: dc, monteCarlo: mc };
  const r = buildRatings(history);
  if (Number.isFinite(r[target.home]) && Number.isFinite(r[target.away])) {
    sources.elo = predictElo({ ratingHome: r[target.home], ratingAway: r[target.away] });
  }
  const e = blend(sources, WEIGHTS);
  const tot = e.home_win + e.draw + e.away_win;
  return [e.home_win / tot, e.draw / tot, e.away_win / tot];
}

/* ---------- rulare walk-forward ---------- */

const picks = [];
for (const code of (args.main ?? 'E0,E1,I1,SP1,D1,N1').split(',').map((s) => s.trim())) {
  const rows = (await loadMainSeasons(code, SEASONS)).filter((r) => r.closingOdds);
  let n = 0;
  for (let i = TRAIN_MIN; i < rows.length; i++) {
    const t = rows[i];
    const history = rows.slice(Math.max(0, i - WINDOW), i);
    if (history.length < 200) continue;
    const p = forecast(history, t, i);
    if (!p) continue;
    const close = closingProbs(t.closingOdds);
    const open = t.openingOdds ? closingProbs(t.openingOdds) : null;
    if (!close) continue;

    const k = p.indexOf(Math.max(...p));
    picks.push({
      league: code, date: t.date, outcome: t.outcome,
      selection: ['1', 'X', '2'][k],
      modelProb: p[k],
      probs: p,
      odds1x2: t.closingOdds,
      odds: t.closingOdds[k],
      closeProbs: close,
      openProbs: open,
      move: open ? lineMove(open, close) : null,
    });
    n++;
  }
  console.error(`${code}: ${n} pick-uri walk-forward`);
}
if (!picks.length) { console.error('Niciun pick.'); process.exit(1); }
console.error(`\nTotal: ${picks.length} pick-uri\n`);

const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));
const sec = (t) => console.log(`\n${'─'.repeat(92)}\n${t}\n`);

/* ---------- A. dubla șansă ---------- */

sec('A. DUBLĂ ȘANSĂ — modelul zice „1", dar joci 1X. Merită cota mai mică?');
console.log('strategie'.padEnd(30) + 'n'.padStart(7) + 'reușită'.padStart(10) + 'cotă medie'.padStart(12) + 'ROI'.padStart(9) + 'IC 95% ROI'.padStart(18));

const DC_OF = { '1': '1X', '2': 'X2', X: null };
const rows = [];

// Simplu: pariezi selecția modelului.
const simple = picks.map((p) => ({ hit: p.outcome === p.selection, odds: p.odds }));
rows.push(['1X2 simplu (referință)', simple]);

// Dublă șansă în jurul selecției modelului.
const dc = picks.filter((p) => DC_OF[p.selection]).map((p) => {
  const pair = DC_OF[p.selection];
  return { hit: doubleChanceHit(pair, p.outcome), odds: doubleChanceOdds(p.odds1x2, pair) };
}).filter((b) => b.odds);
rows.push(['dublă șansă pe pick', dc]);

// Doar pick-urile cu încredere mare.
for (const th of [0.5, 0.6, 0.7]) {
  const conf = picks.filter((p) => p.modelProb >= th && DC_OF[p.selection]);
  const s = conf.map((p) => ({ hit: p.outcome === p.selection, odds: p.odds }));
  const d = conf.map((p) => {
    const pair = DC_OF[p.selection];
    return { hit: doubleChanceHit(pair, p.outcome), odds: doubleChanceOdds(p.odds1x2, pair) };
  }).filter((b) => b.odds);
  rows.push([`1X2, încredere ≥${th * 100}%`, s]);
  rows.push([`dublă șansă, încredere ≥${th * 100}%`, d]);
}

for (const [label, bets] of rows) {
  if (!bets.length) continue;
  const r = flatRoi(bets);
  const boot = bootstrapRoi(bets);
  console.log(
    label.padEnd(30) + String(r.n).padStart(7) + `${f(r.hit_rate_pct, 1)}%`.padStart(10) +
    f(r.mean_odds).padStart(12) + `${f(r.roi_pct, 1)}%`.padStart(9) +
    `[${f(boot.ci95[0], 1)}, ${f(boot.ci95[1], 1)}]`.padStart(18)
  );
}

/* ---------- B. bilete combinate ---------- */

sec('B. BILETE COMBINATE — 3-4 meciuri, cotă mică, certitudine bună');

/** Grupează pick-urile în bilete de n picioare, în ordine cronologică. */
function buildSlips(pool, legsPerSlip) {
  const sorted = [...pool].sort((a, b) => a.date.localeCompare(b.date));
  const slips = [];
  for (let i = 0; i + legsPerSlip <= sorted.length; i += legsPerSlip) {
    slips.push(accumulator(sorted.slice(i, i + legsPerSlip)));
  }
  return slips;
}

console.log('strategie'.padEnd(34) + 'bilete'.padStart(8) + 'ieșite'.padStart(9) + 'cotă medie'.padStart(12) + 'ROI real'.padStart(10) + 'ROI teoretic'.padStart(14));

for (const [label, pool] of [
  ['toate pick-urile', picks],
  ['încredere ≥60%', picks.filter((p) => p.modelProb >= 0.6)],
  ['încredere ≥70%', picks.filter((p) => p.modelProb >= 0.7)],
  ['dublă șansă ≥70%', null],
]) {
  let bets;
  if (label === 'dublă șansă ≥70%') {
    bets = picks.filter((p) => p.modelProb >= 0.7 && DC_OF[p.selection]).map((p) => {
      const pair = DC_OF[p.selection];
      return { date: p.date, hit: doubleChanceHit(pair, p.outcome), odds: doubleChanceOdds(p.odds1x2, pair) };
    }).filter((b) => b.odds);
  } else {
    bets = pool.map((p) => ({ date: p.date, hit: p.outcome === p.selection, odds: p.odds }));
  }
  if (bets.length < 40) continue;
  const single = flatRoi(bets);
  for (const legs of [1, 2, 3, 4]) {
    const slips = legs === 1
      ? bets.map((b) => accumulator([b]))
      : buildSlips(bets, legs);
    if (slips.length < 20) continue;
    const hit = slips.filter((s) => s.hit).length;
    const roi = slips.reduce((a, s) => a + s.profit, 0) / slips.length * 100;
    const theo = theoreticalAccumulatorRoi(single.roi_pct / 100, legs) * 100;
    console.log(
      `${label} · ${legs} ${legs === 1 ? 'picior' : 'picioare'}`.padEnd(34) +
      String(slips.length).padStart(8) + `${f((hit / slips.length) * 100, 1)}%`.padStart(9) +
      f(slips.reduce((a, s) => a + s.combined_odds, 0) / slips.length).padStart(12) +
      `${f(roi, 1)}%`.padStart(10) + `${f(theo, 1)}%`.padStart(14)
    );
  }
  console.log('');
}

/* ---------- C. mișcarea liniei ---------- */

sec('C. MIȘCAREA LINIEI — urmărești banii, nu modelul');
const withMove = picks.filter((p) => p.move);
if (!withMove.length) {
  console.log('Fără cote de deschidere în setul încărcat.\n');
} else {
  console.log('strategie'.padEnd(34) + 'n'.padStart(7) + 'reușită'.padStart(10) + 'cotă medie'.padStart(12) + 'ROI'.padStart(9) + 'IC 95% ROI'.padStart(18));
  const idx = { '1': 0, X: 1, '2': 2 };
  const variants = [
    ['urmează steam-ul (la închidere)', withMove.map((p) => ({ hit: p.outcome === p.move.steam, odds: p.odds1x2[idx[p.move.steam]] }))],
    ['fade steam-ul (joci drift-ul)', withMove.map((p) => ({ hit: p.outcome === p.move.drift, odds: p.odds1x2[idx[p.move.drift]] }))],
  ];
  for (const mag of [1, 2, 3]) {
    const strong = withMove.filter((p) => p.move.magnitude_pp >= mag);
    if (strong.length >= 100) {
      variants.push([`steam, mișcare ≥${mag}pp`, strong.map((p) => ({ hit: p.outcome === p.move.steam, odds: p.odds1x2[idx[p.move.steam]] }))]);
    }
  }
  variants.push(['model ȘI steam de acord', withMove.filter((p) => p.selection === p.move.steam)
    .map((p) => ({ hit: p.outcome === p.selection, odds: p.odds }))]);
  variants.push(['model ȘI steam în dezacord', withMove.filter((p) => p.selection !== p.move.steam)
    .map((p) => ({ hit: p.outcome === p.selection, odds: p.odds }))]);

  for (const [label, bets] of variants) {
    if (bets.length < 50) continue;
    const r = flatRoi(bets);
    const boot = bootstrapRoi(bets);
    console.log(
      label.padEnd(34) + String(r.n).padStart(7) + `${f(r.hit_rate_pct, 1)}%`.padStart(10) +
      f(r.mean_odds).padStart(12) + `${f(r.roi_pct, 1)}%`.padStart(9) +
      `[${f(boot.ci95[0], 1)}, ${f(boot.ci95[1], 1)}]`.padStart(18)
    );
  }
}
console.log('');
