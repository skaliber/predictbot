#!/usr/bin/env node
/**
 * Raport de edge pe slice-uri (ligă × piață × prag), vs cote de ÎNCHIDERE.
 *
 * Reguli respectate (skill predictbot-edge + backtesting-frameworks):
 *   - point-in-time: la meciul t, modelele văd doar meciuri cu start < t
 *   - walk-forward: fereastră glisantă, testul niciodată în antrenare
 *   - de-vig pe închidere, nu pe deschidere
 *   - un pick există doar dacă p_model − p_close ≥ prag
 *   - promovare doar dacă CLV > 0 ȘI ROI > 0 ȘI n ≥ 200
 *
 *   node scripts/edgeReport.js --leagues=ROU,POL,AUT --thresholds=3,5,8
 *   node scripts/edgeReport.js --main=E0,E1,D1,I1,SP1,N1 --seasons=2122,2223,2324,2425
 */
import { loadExtraLeague, loadMainSeasons } from '../src/lib/footballData.js';
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { buildRatings, predictElo } from '../src/models/elo.js';
import { simulate } from '../src/models/monteCarlo.js';
import { blend } from '../src/models/ensemble.js';
import { closingProbs, clvPoints, clvOddsPct, logLoss, logLossBinary, sliceSummary } from '../src/lib/clv.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
const THRESHOLDS = (args.thresholds ?? '3,5,8').split(',').map(Number);
const TRAIN_MIN = Number(args['train-min'] ?? 380);   // ≈ un sezon înainte de primul test
const WINDOW = Number(args.window ?? 1140);            // ≈ 3 sezoane de antrenare
const SIMS = Number(args.simulations ?? 4000);
const WEIGHTS = { dixonColes: 0.4, monteCarlo: 0.2, elo: 0.4 };

/** Un pas walk-forward: modelele văd exclusiv meciuri anterioare. */
function forecast(history, target, seed) {
  let fit;
  try {
    fit = fitDixonColes(history, { referenceDate: target.date });
    lambdasFromFit(fit, target.home, target.away);
  } catch { return null; }
  const dc = predictDixonColes({ fit, home: target.home, away: target.away });
  const mc = simulate(dc.matrix, { simulations: SIMS, seed });
  const sources = { dixonColes: dc, monteCarlo: mc };
  const ratings = buildRatings(history);
  if (Number.isFinite(ratings[target.home]) && Number.isFinite(ratings[target.away])) {
    sources.elo = predictElo({ ratingHome: ratings[target.home], ratingAway: ratings[target.away] });
  }
  const e = blend(sources, WEIGHTS);
  const tot = e.home_win + e.draw + e.away_win;
  return {
    x2: [e.home_win / tot, e.draw / tot, e.away_win / tot],
    over25: mc.over25,
  };
}

/** Rulează walk-forward pe o ligă și adună pariurile candidate. */
function runLeague(rows, leagueLabel) {
  const bets = { '1x2': [], over25: [] };
  let evaluated = 0, skippedNoOdds = 0;

  for (let i = TRAIN_MIN; i < rows.length; i++) {
    const target = rows[i];
    const history = rows.slice(Math.max(0, i - WINDOW), i);
    if (history.length < 200) continue;

    // CLV real cere ȘI deschidere, ȘI închidere: pariem la deschidere și
    // măsurăm unde a închis piața. Fără deschidere nu există studiu de CLV.
    const has1x2 = target.openingOdds && target.closingOdds;
    const hasOu = target.ouOpeningOdds && target.ouClosingOdds;
    if (!has1x2 && !hasOu) { skippedNoOdds++; continue; }
    const f = forecast(history, target, i);
    if (!f) continue;
    evaluated++;

    // 1X2: pariem la DESCHIDERE, comparăm cu ÎNCHIDEREA.
    if (has1x2) {
      const open = closingProbs(target.openingOdds);
      const close = closingProbs(target.closingOdds);
      if (open && close) {
        const llModel = logLoss(f.x2, target.outcome);
        const llMarket = logLoss(close, target.outcome);
        ['1', 'X', '2'].forEach((sel, k) => {
          bets['1x2'].push({
            league: leagueLabel, selection: sel, date: target.date,
            modelProb: f.x2[k], openProb: open[k], closingProb: close[k],
            // Selecția se face pe dezacordul cu prețul la care pariem.
            edge_pp: (f.x2[k] - open[k]) * 100,
            odds: target.openingOdds[k],
            closeOdds: target.closingOdds[k],
            hit: target.outcome === sel,
            clv: clvPoints({ openProb: open[k], closingProb: close[k] }),
            clv_odds_pct: clvOddsPct({ openOdds: target.openingOdds[k], closeOdds: target.closingOdds[k] }),
            logLossModel: llModel, logLossMarket: llMarket,
          });
        });
      }
    }

    // Over/Under 2.5, la fel: deschidere pentru pariu, închidere pentru CLV.
    if (hasOu) {
      const open = closingProbs(target.ouOpeningOdds);
      const close = closingProbs(target.ouClosingOdds);
      if (open && close) {
        const over = target.goals > 2.5;
        [['Over 2.5', f.over25, 0, over], ['Under 2.5', 1 - f.over25, 1, !over]]
          .forEach(([sel, p, k, hit]) => {
            bets.over25.push({
              league: leagueLabel, selection: sel, date: target.date,
              modelProb: p, openProb: open[k], closingProb: close[k],
              edge_pp: (p - open[k]) * 100,
              odds: target.ouOpeningOdds[k],
              closeOdds: target.ouClosingOdds[k],
              hit,
              clv: clvPoints({ openProb: open[k], closingProb: close[k] }),
              clv_odds_pct: clvOddsPct({ openOdds: target.ouOpeningOdds[k], closeOdds: target.ouClosingOdds[k] }),
              logLossModel: logLossBinary(f.over25, over),
              logLossMarket: logLossBinary(close[0], over),
            });
          });
      }
    }
  }
  return { bets, evaluated, skippedNoOdds };
}

/* ---------- încărcare ---------- */

const leagues = [];
// Ligile suplimentare (ROU/POL/AUT) au DOAR cote de închidere. Fără deschidere
// nu există CLV măsurabil, deci nu pot intra într-un raport de edge — ar fi
// exact greșeala de a numi „CLV" diferența model−închidere.
for (const code of (args.leagues ?? '').split(',').filter(Boolean)) {
  console.error(`${code.trim()}: sărit — sursa are doar cote de închidere, CLV nemăsurabil`);
}

const seasons = (args.seasons ?? '2122,2223,2324,2425').split(',').map((s) => s.trim());
for (const code of (args.main ?? '').split(',').filter(Boolean)) {
  const rows = (await loadMainSeasons(code.trim(), seasons))
    .filter((r) => r.closingOdds || r.ouClosingOdds);
  if (rows.length) leagues.push({ label: code.trim(), rows });
  console.error(`${code}: ${rows.length} meciuri cu cote de închidere`);
}
if (!leagues.length) { console.error('Nicio ligă încărcată. Dă --leagues=ROU sau --main=E0'); process.exit(1); }

/* ---------- rulare ---------- */

const all = { '1x2': [], over25: [] };
for (const { label, rows } of leagues) {
  const r = runLeague(rows, label);
  all['1x2'].push(...r.bets['1x2']);
  all.over25.push(...r.bets.over25);
  console.error(`${label}: ${r.evaluated} meciuri evaluate walk-forward`);
}

/* ---------- raport ---------- */

const rows = [];
for (const market of ['1x2', 'over25']) {
  const pool = all[market];
  if (!pool.length) continue;
  for (const th of THRESHOLDS) {
    const picks = pool.filter((b) => b.edge_pp >= th);
    if (!picks.length) continue;
    rows.push({ slice: `TOATE · ${market} · edge≥${th}pp`, ...sliceSummary(picks) });
    for (const lg of [...new Set(pool.map((b) => b.league))]) {
      const lp = picks.filter((b) => b.league === lg);
      if (lp.length >= 30) rows.push({ slice: `${lg} · ${market} · edge≥${th}pp`, ...sliceSummary(lp) });
    }
  }
}

const f = (x, d = 2) => (x === null || x === undefined ? '—' : x.toFixed(d));
console.log(`\n${'═'.repeat(104)}`);
console.log('RAPORT DE EDGE — vs cote de ÎNCHIDERE, walk-forward, point-in-time');
console.log('PASS cere: CLV > 0  ȘI  ROI > 0  ȘI  n ≥ 200');
console.log('═'.repeat(104));
console.log('slice'.padEnd(34) + 'n'.padStart(6) + 'reușită'.padStart(9) + 'ROI'.padStart(9) +
  'IC 95% ROI'.padStart(18) + 'CLV'.padStart(9) + 'LL mod'.padStart(9) + 'LL piață'.padStart(9) + '  verdict');
console.log('─'.repeat(104));
for (const r of rows.sort((a, b) => (b.mean_clv_pp ?? -99) - (a.mean_clv_pp ?? -99))) {
  console.log(
    r.slice.padEnd(34) + String(r.n).padStart(6) + `${f(r.hit_rate_pct, 1)}%`.padStart(9) +
    `${f(r.roi_pct, 1)}%`.padStart(9) +
    `[${f(r.roi_ci95[0], 1)}, ${f(r.roi_ci95[1], 1)}]`.padStart(18) +
    `${f(r.mean_clv_pp, 1)}pp`.padStart(9) +
    f(r.logloss_model, 3).padStart(9) + f(r.logloss_market, 3).padStart(9) +
    '  ' + (r.verdict === 'PASS' ? 'PASS' : `FAIL (${r.fail_reasons.join(', ')})`)
  );
}
const passed = rows.filter((r) => r.verdict === 'PASS');
console.log('─'.repeat(104));
console.log(`${rows.length} slice-uri testate · ${passed.length} PASS · ${rows.length - passed.length} FAIL\n`);
if (args.json) console.log(JSON.stringify(rows, null, 2));
