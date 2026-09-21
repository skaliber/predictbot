#!/usr/bin/env node
/**
 * Compară toate personalitățile pe același set istoric. Fiecare are ponderi și
 * politică de selecție diferite — întrebarea e dacă vreuna chiar e mai bună.
 *
 *   node scripts/validatePersonalities.js --from=2025-08-01 --to=2026-06-30
 */
import { listMatches, extractOdds } from '../src/dataFetcher.js';
import { replayMatch } from '../src/bot/replay.js';
import { personalities } from '../src/bot/personalities.js';
import { wilsonInterval } from '../src/lib/stats.js';
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

const leagues = (args.leagues ?? 'PL,PD,SA,BL1,FL1').split(',').map((s) => s.trim());
const simulations = Number(args.simulations ?? 3000);

/** Încarcă și pregătește un sezon de ligă. */
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

const datasets = [];
for (const league of leagues) {
  const all = await load(league);
  const minTrain = Number(args['min-train'] ?? Math.max(80, Math.floor(all.length * 0.45)));
  if (all.length < minTrain + 20) { console.error(`${league}: prea puține meciuri`); continue; }
  datasets.push({ league, all, minTrain });
  console.error(`${league}: ${all.length} meciuri, antrenare de la ${minTrain}`);
}

const botIds = Object.keys(personalities);
const summary = [];

for (const botId of botIds) {
  const rows = [];
  for (const { all, minTrain } of datasets) {
    for (let i = minTrain; i < all.length; i++) {
      const r = replayMatch({ history: all.slice(0, i), target: all[i], personalityId: botId, simulations, seed: i });
      if (r) rows.push(r);
    }
  }
  const picks = rows.filter((r) => r.selection);
  const wins = picks.filter((r) => r.hit).length;
  const withOdds = picks.filter((r) => Number.isFinite(r.odds));
  const flat = withOdds.reduce((s, r) => s + (r.hit ? r.odds - 1 : -1), 0);
  const kStake = withOdds.reduce((s, r) => s + (r.kelly_stake ?? 0), 0);
  const kProfit = withOdds.reduce((s, r) => s + (r.hit ? (r.kelly_stake ?? 0) * (r.odds - 1) : -(r.kelly_stake ?? 0)), 0);
  // RPS/Brier pe distribuția completă, nu doar pe pick — măsoară calitatea probabilităților.
  const scored = rows.filter((r) => r.probs);
  const rpsAvg = scored.reduce((s, r) => s + rps(r.probs, r.outcome), 0) / (scored.length || 1);
  const brierAvg = scored.reduce((s, r) => s + brier(r.probs, r.outcome), 0) / (scored.length || 1);

  summary.push({
    bot: botId,
    evaluated: rows.length,
    picks: picks.length,
    no_bets: rows.length - picks.length,
    wins,
    hit_rate_pct: picks.length ? (wins / picks.length) * 100 : null,
    ci95: picks.length ? wilsonInterval(wins, picks.length) : [0, 0],
    roi_flat_pct: withOdds.length ? (flat / withOdds.length) * 100 : null,
    roi_kelly_pct: kStake > 0 ? (kProfit / kStake) * 100 : null,
    rps: rpsAvg,
    brier: brierAvg,
  });
  console.error(`${botId}: ${picks.length} pick-uri din ${rows.length}`);
}

if (args.json) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }

const p = (x) => (x === null ? '—' : `${x.toFixed(1)}%`);
console.log(`\n=== Personalități — ${datasets.reduce((s, d) => s + d.all.length - d.minTrain, 0)} meciuri, ${leagues.join('/')} ===\n`);
console.log('bot'.padEnd(17) + 'pick-uri'.padStart(9) + 'no-bet'.padStart(8) + 'rată'.padStart(8) + 'IC 95%'.padStart(15) + 'ROI flat'.padStart(10) + 'ROI Kelly'.padStart(11) + 'RPS'.padStart(9));
for (const s of [...summary].sort((a, b) => (b.roi_flat_pct ?? -999) - (a.roi_flat_pct ?? -999))) {
  console.log(
    s.bot.padEnd(17) + String(s.picks).padStart(9) + String(s.no_bets).padStart(8) +
    p(s.hit_rate_pct).padStart(8) +
    `${s.ci95[0].toFixed(0)}–${s.ci95[1].toFixed(0)}%`.padStart(15) +
    p(s.roi_flat_pct).padStart(10) + p(s.roi_kelly_pct).padStart(11) +
    s.rps.toFixed(4).padStart(9)
  );
}
console.log('\nRPS mai mic = probabilități mai bune. ROI pozitiv = ar fi produs profit.\n');
