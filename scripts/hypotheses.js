#!/usr/bin/env node
/**
 * Testează ipoteze de piață care NU sunt în model. Nu se antrenează nimic —
 * doar cote și rezultate, deci eșantionul e tot ce există în bază.
 *
 * Ipotezele testate:
 *   H1  Favourite-longshot bias — piața supraevaluează outsiderii?
 *   H2  Poziție — gazdele/oaspeții/egalul sunt sistematic mispricing-uite?
 *   H3  Marja bookmakerului — meciurile cu marjă mare sunt mai puțin eficiente?
 *   H4  Faza sezonului — piața e mai slabă la început, când are puține date?
 *   H5  Ligă — există campionate unde piața e mai slabă?
 *   H6  Outsider pe teren propriu — categoria clasică de mispricing.
 *   H7  Meciuri echilibrate — egalul e subevaluat când nu există favorit clar?
 *
 * Pentru fiecare: ROI la pariu plat, eroare standard, și t (de câte erori
 * standard e departe de zero). Sub |t| = 2 nu se poate afirma nimic.
 */
import { listMatches, extractOdds } from '../src/dataFetcher.js';
import { cached } from '../src/lib/cache.js';
import { flatRoi, margin, bucketRoi, bucketize } from '../src/lib/hypothesis.js';
import { devig } from '../src/betting/odds.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
const from = args.from ?? '2021-08-01';
const to = args.to ?? '2026-06-30';

// Ligile cu acoperire reală de cote (după numărul de meciuri cu cote în bază).
const LEAGUES = (args.leagues ?? '77,76,446,PL,PD,SA,6,FL1,8,45,61,68,BL1,60,196,72,CL,75,245,15,220,43')
  .split(',').map((s) => s.trim());

const all = [];
for (const league of LEAGUES) {
  try {
    const rows = await cached(
      ['finished', league, from, to],
      () => listMatches({ status: 'FINISHED', league, from, to, limit: 4000 })
    );
    let n = 0;
    for (const m of rows) {
      if (!Number.isFinite(m.score_home) || !Number.isFinite(m.score_away)) continue;
      const odds = extractOdds(m)?.odds?.['1x2'];
      if (!odds) continue;
      const outcome = m.score_home > m.score_away ? '1' : m.score_home === m.score_away ? 'X' : '2';
      all.push({
        league, league_name: m.league_name, date: m.match_date, odds, outcome,
        goals: m.score_home + m.score_away,
      });
      n++;
    }
    console.error(`${league} ${rows[0]?.league_name ?? ''}: ${n} meciuri cu cote`);
  } catch (err) { console.error(`${league}: ${err.message}`); }
}

if (!all.length) { console.error('Niciun meci.'); process.exit(1); }
console.error(`\nTotal: ${all.length} meciuri cu cote\n`);

/** Un pariu pe o poziție dată (0=gazde, 1=egal, 2=oaspeți). */
const bet = (m, i) => ({ hit: m.outcome === ['1', 'X', '2'][i], odds: m.odds[i], m, pos: i });
/** Toate cele 3 pariuri posibile per meci — pentru analize pe cotă. */
const allBets = all.flatMap((m) => [0, 1, 2].map((i) => bet(m, i)));

const fmt = (r) => r
  ? `${String(r.n).padStart(6)} ${(`${r.roi_pct >= 0 ? '+' : ''}${r.roi_pct.toFixed(2)}%`).padStart(9)} ` +
    `± ${r.se_pct.toFixed(2)}  t=${r.t.toFixed(2).padStart(6)}  cotă ${r.mean_odds.toFixed(2).padStart(6)}  ` +
    `reușită ${r.hit_rate_pct.toFixed(1)}%`
  : '—';

const section = (title) => console.log(`\n${'─'.repeat(78)}\n${title}\n`);
const header = () => console.log('categorie'.padEnd(24) + 'n'.padStart(6) + 'ROI'.padStart(10) + '  eroare      t     cotă   reușită');

/* H1 — favourite-longshot bias */
section('H1. Favourite-longshot bias — piața supraevaluează outsiderii?');
header();
const oddsEdges = [1, 1.5, 2, 3, 5, 10, 1000];
const oddsLabels = ['1.00–1.50', '1.50–2.00', '2.00–3.00', '3.00–5.00', '5.00–10.0', '10.0+'];
for (const r of bucketRoi(allBets, (b) => bucketize(b.odds, oddsEdges, oddsLabels), oddsLabels)) {
  console.log(String(r.bucket).padEnd(24) + fmt(r));
}

/* H2 — poziție */
section('H2. Poziție — gazde / egal / oaspeți');
header();
for (const [i, name] of [[0, 'gazde (1)'], [1, 'egal (X)'], [2, 'oaspeți (2)']]) {
  console.log(name.padEnd(24) + fmt(flatRoi(all.map((m) => bet(m, i)))));
}

/* H3 — marja bookmakerului */
section('H3. Marja bookmakerului — meciurile „incerte" sunt mai slab evaluate?');
header();
const marginEdges = [0, 0.04, 0.06, 0.08, 0.12, 10];
const marginLabels = ['sub 4%', '4–6%', '6–8%', '8–12%', 'peste 12%'];
for (const r of bucketRoi(allBets, (b) => bucketize(margin(b.m.odds), marginEdges, marginLabels), marginLabels)) {
  console.log(String(r.bucket).padEnd(24) + fmt(r));
}

/* H4 — faza sezonului */
section('H4. Faza sezonului — piața are mai puține date la început?');
header();
const monthPhase = (d) => {
  const mth = new Date(d).getUTCMonth() + 1;
  if (mth >= 7 && mth <= 9) return 'început (iul–sep)';
  if (mth >= 10 && mth <= 12) return 'mijloc (oct–dec)';
  if (mth >= 1 && mth <= 3) return 'iarnă (ian–mar)';
  return 'final (apr–iun)';
};
const phases = ['început (iul–sep)', 'mijloc (oct–dec)', 'iarnă (ian–mar)', 'final (apr–iun)'];
for (const r of bucketRoi(allBets, (b) => monthPhase(b.m.date), phases)) {
  console.log(String(r.bucket).padEnd(24) + fmt(r));
}

/* H5 — pe ligă, pariind favoritul */
section('H5. Pe ligă — pariind sistematic favoritul (cota cea mai mică)');
header();
const favBets = all.map((m) => {
  const i = m.odds.indexOf(Math.min(...m.odds));
  return bet(m, i);
});
const byLeague = bucketRoi(favBets, (b) => `${b.m.league} ${(b.m.league_name ?? '').slice(0, 16)}`)
  .filter((r) => r.n >= 300)
  .sort((a, b) => b.roi_pct - a.roi_pct);
for (const r of byLeague) console.log(String(r.bucket).padEnd(24) + fmt(r));

/* H6 — outsider pe teren propriu */
section('H6. Outsider pe teren propriu — categoria clasică de mispricing');
header();
const homeDog = all.filter((m) => m.odds[0] > m.odds[2]);
console.log('gazde outsider'.padEnd(24) + fmt(flatRoi(homeDog.map((m) => bet(m, 0)))));
const homeDogBig = homeDog.filter((m) => m.odds[0] >= 3);
console.log('gazde outsider ≥3.00'.padEnd(24) + fmt(flatRoi(homeDogBig.map((m) => bet(m, 0)))));
const awayFav = all.filter((m) => m.odds[2] < m.odds[0]);
console.log('oaspeți favoriți'.padEnd(24) + fmt(flatRoi(awayFav.map((m) => bet(m, 2)))));

/* H7 — meciuri echilibrate, pariind egalul */
section('H7. Meciuri echilibrate — egalul e subevaluat fără favorit clar?');
header();
const spread = (m) => Math.abs(m.odds[0] - m.odds[2]);
const spreadEdges = [0, 0.3, 0.8, 2, 1000];
const spreadLabels = ['foarte echilibrat', 'echilibrat', 'favorit clar', 'dezechilibru mare'];
for (const r of bucketRoi(all.map((m) => bet(m, 1)), (b) => bucketize(spread(b.m), spreadEdges, spreadLabels), spreadLabels)) {
  console.log(String(r.bucket).padEnd(24) + fmt(r));
}

/* H8 — combinația: cele trei semnale care au ieșit în aceeași direcție */
section('H8. Combinat — favorit scurt + marjă mică + ligă de top');
console.log('H1, H3 și H5 arată toate spre același lucru. Combinate, cât de departe ajung?\n');
header();
const TOP = new Set(['PL', 'PD', 'SA', 'BL1', 'FL1', 'CL', '245', '6', '8']);
const favOf = (m) => { const i = m.odds.indexOf(Math.min(...m.odds)); return bet(m, i); };

const filters = [
  ['toate pariurile', () => true],
  ['doar favoritul', () => true],
  ['+ cotă sub 2.00', (b) => b.odds < 2],
  ['+ cotă sub 1.60', (b) => b.odds < 1.6],
  ['+ marjă sub 6%', (b) => margin(b.m.odds) < 0.06],
  ['+ ligă de top', (b) => TOP.has(b.m.league)],
];
let pool = all.map(favOf);
console.log('doar favoritul'.padEnd(24) + fmt(flatRoi(pool)));
let label = 'favorit';
for (const [name, fn] of filters.slice(2)) {
  pool = pool.filter(fn);
  label += ` ${name.replace('+ ', '')}`;
  console.log(name.padEnd(24) + fmt(flatRoi(pool)));
  if (pool.length < 100) { console.log('   (eșantion prea mic pentru a continua)'); break; }
}
const compound = flatRoi(pool);

/* Sinteză */
section('Sinteză — ce a trecut pragul statistic');
const candidates = [];
const collect = (label, r) => { if (r && r.n >= 200) candidates.push({ label, ...r }); };
for (const r of bucketRoi(allBets, (b) => bucketize(b.odds, oddsEdges, oddsLabels), oddsLabels)) collect(`H1 cotă ${r.bucket}`, r);
for (const [i, name] of [[0, 'H2 gazde'], [1, 'H2 egal'], [2, 'H2 oaspeți']]) collect(name, flatRoi(all.map((m) => bet(m, i))));
for (const r of bucketRoi(allBets, (b) => bucketize(margin(b.m.odds), marginEdges, marginLabels), marginLabels)) collect(`H3 marjă ${r.bucket}`, r);
for (const r of byLeague) collect(`H5 ${r.bucket}`, r);
collect('H6 gazde outsider ≥3', flatRoi(homeDogBig.map((m) => bet(m, 0))));
collect('H8 combinat', compound);

const strong = candidates.filter((c) => Math.abs(c.t) >= 2).sort((a, b) => b.t - a.t);
if (!strong.length) {
  console.log('Nicio strategie nu se abate semnificativ de zero (|t| ≥ 2).');
  console.log('Piața e eficientă pe toate segmentele testate.\n');
} else {
  console.log('strategie'.padEnd(34) + 'n'.padStart(6) + 'ROI'.padStart(10) + '      t');
  for (const c of strong) {
    console.log(c.label.padEnd(34) + String(c.n).padStart(6) +
      `${c.roi_pct >= 0 ? '+' : ''}${c.roi_pct.toFixed(2)}%`.padStart(10) + c.t.toFixed(2).padStart(7));
  }
  console.log(`\nAtenție: ${candidates.length} strategii testate. La atâtea teste, unele trec pragul`);
  console.log('din întâmplare. Un ROI pozitiv aici e ipoteză de verificat, nu descoperire.\n');
}
