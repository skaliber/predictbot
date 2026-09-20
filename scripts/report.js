#!/usr/bin/env node
/**
 * Raport de performanță per bot: acuratețe, ROI, split pe piață.
 *   node scripts/report.js [--since=2026-09-01]
 */
import { loadPredictions } from '../src/lib/store.js';
import { summarize } from '../src/lib/accuracy.js';
import { personalities } from '../src/bot/personalities.js';

const since = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1];

const all = await loadPredictions({ since });
if (!all.length) { console.log('Nicio predicție salvată.'); process.exit(0); }

const rows = [];
for (const id of Object.keys(personalities)) {
  const mine = all.filter((p) => p.bot?.id === id);
  if (!mine.length) continue;
  rows.push({ bot: id, ...summarize(mine) });
}

rows.sort((a, b) => (b.accuracy_pct ?? -1) - (a.accuracy_pct ?? -1));
console.log(`\nLeaderboard (${all.length} predicții${since ? ` din ${since}` : ''})\n`);
console.log('bot'.padEnd(18) + 'pred'.padStart(6) + 'pariuri'.padStart(9) + 'settled'.padStart(9) + 'acuratețe'.padStart(11) + 'ROI Kelly'.padStart(11) + 'ROI flat'.padStart(10));
for (const r of rows) {
  console.log(
    r.bot.padEnd(18) +
    String(r.predictions).padStart(6) +
    String(r.bets).padStart(9) +
    String(r.settled).padStart(9) +
    `${r.accuracy_pct ?? '—'}%`.padStart(11) +
    `${r.kelly_roi_pct ?? '—'}%`.padStart(11) +
    `${r.flat_roi_pct ?? '—'}%`.padStart(10)
  );
}
console.log();
