#!/usr/bin/env node
/**
 * Validarea tier-urilor: rulează replay-ul istoric pe un sezon și verifică
 * dacă SAFE chiar iese mai des decât MODERATE, și MODERATE decât RISKY.
 *
 *   node scripts/validateTiers.js --league=SA --from=2025-08-01 --to=2026-06-30
 *   node scripts/validateTiers.js --leagues=PL,PD,SA,BL1,FL1 --from=... --to=...
 *
 * Ieșirea: rata de reușită și ROI per tier, plus calibrarea pe bucket-uri de
 * probabilitate (predicția de 70% chiar iese în 70% din cazuri?).
 */
import { listMatches, extractOdds } from '../src/dataFetcher.js';
import { replayMatch } from '../src/bot/replay.js';
import { wilsonInterval, calibrationBuckets, tierTable, flagTable } from '../src/lib/stats.js';

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
  }
  return a;
}
const args = parseArgs();
if (!args.from || !args.to) {
  console.error('Eroare: --from și --to sunt obligatorii (altfel /matches întoarce doar fereastra recentă).');
  process.exit(1);
}

const leagues = (args.leagues ?? args.league ?? 'PL,PD,SA,BL1,FL1').split(',').map((s) => s.trim());
const personalityId = args.bot ?? 'ai-analyst';
const simulations = Number(args.simulations ?? 4000);

async function loadLeague(league) {
  const rows = await listMatches({ status: 'FINISHED', league, from: args.from, to: args.to, limit: 800 });
  return rows
    .filter((m) => Number.isFinite(m.score_home) && Number.isFinite(m.score_away))
    .map((m) => ({
      slug: m.slug, home: m.home_team, away: m.away_team,
      homeGoals: m.score_home, awayGoals: m.score_away, date: m.match_date,
      odds: extractOdds(m)?.odds?.['1x2'] ?? null,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const results = [];
const perLeague = {};

for (const league of leagues) {
  const all = await loadLeague(league);
  const minTrain = Number(args['min-train'] ?? Math.max(80, Math.floor(all.length * 0.45)));
  if (all.length < minTrain + 20) {
    console.error(`${league}: doar ${all.length} meciuri — sar peste.`);
    continue;
  }
  const rows = [];
  for (let i = minTrain; i < all.length; i++) {
    const r = replayMatch({
      history: all.slice(0, i), target: all[i], personalityId, simulations, seed: i,
    });
    if (r) { r.league = league; rows.push(r); results.push(r); }
  }
  perLeague[league] = { evaluated: rows.length, withOdds: rows.filter((r) => r.odds).length };
  console.error(`${league}: ${rows.length} meciuri evaluate (${perLeague[league].withOdds} cu cote)`);
}

if (!results.length) { console.error('Niciun rezultat.'); process.exit(1); }

const report = {
  generated_at: new Date().toISOString(),
  window: { from: args.from, to: args.to },
  bot: personalityId,
  leagues: perLeague,
  evaluated: results.length,
  by_tier: tierTable(results),
  calibration: calibrationBuckets(results),
  by_flag: flagTable(results),
};

if (args.json) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const pct = (x) => (x === null ? '—' : `${x.toFixed(1)}%`);
console.log(`\n=== Validare tier-uri — ${results.length} meciuri, ${leagues.join('/')}, bot ${personalityId} ===\n`);
console.log('tier'.padEnd(10) + 'n'.padStart(6) + 'reușite'.padStart(9) + 'rată'.padStart(8) + 'IC 95%'.padStart(16) + 'prob medie'.padStart(12) + 'ROI flat'.padStart(10) + 'ROI Kelly'.padStart(11));
for (const t of report.by_tier) {
  console.log(
    t.tier.padEnd(10) + String(t.n).padStart(6) + String(t.wins).padStart(9) +
    pct(t.hit_rate_pct).padStart(8) +
    `${t.ci95[0].toFixed(1)}–${t.ci95[1].toFixed(1)}%`.padStart(16) +
    pct(t.mean_prob_pct).padStart(12) +
    (t.roi_flat_pct === null ? '—' : pct(t.roi_flat_pct)).padStart(10) +
    (t.roi_kelly_pct === null ? '—' : pct(t.roi_kelly_pct)).padStart(11)
  );
}

console.log('\n--- Calibrare: probabilitatea declarată vs frecvența reală ---\n');
console.log('bucket'.padEnd(12) + 'n'.padStart(6) + 'prob medie'.padStart(12) + 'real'.padStart(9) + 'eroare'.padStart(10));
for (const b of report.calibration) {
  console.log(
    b.bucket.padEnd(12) + String(b.n).padStart(6) + pct(b.mean_prob_pct).padStart(12) +
    pct(b.actual_pct).padStart(9) +
    `${b.error_pp > 0 ? '+' : ''}${b.error_pp.toFixed(1)}pp`.padStart(10)
  );
}

console.log('\n--- Efectul fiecărui flag (meciuri unde a apărut) ---\n');
console.log('flag'.padEnd(24) + 'n'.padStart(6) + 'rată cu'.padStart(10) + 'rată fără'.padStart(11) + 'diferență'.padStart(11));
for (const f of report.by_flag) {
  console.log(
    f.code.padEnd(24) + String(f.n).padStart(6) + pct(f.hit_with_pct).padStart(10) +
    pct(f.hit_without_pct).padStart(11) +
    `${f.delta_pp > 0 ? '+' : ''}${f.delta_pp.toFixed(1)}pp`.padStart(11)
  );
}
console.log();
