#!/usr/bin/env node
/**
 * Validarea sitei pe exact situația de folosire: zile cu multe meciuri, din
 * care alegi primele 3-4.
 *
 * Comparăm trei moduri de a alege top N pe zi:
 *   A. doar piața      — favoritul cu cea mai mare probabilitate de-vigată
 *   B. doar modelul    — Dixon-Coles + Elo, walk-forward
 *   C. sita            — piață ancorată + ajustare de model + filtru de acord
 *
 * Întrebarea: care alege pick-uri care CHIAR ies mai des, și cât de onest își
 * declară probabilitatea (calibrare)? Plus rata de bilete întregi de 2 și 3
 * meciuri, fiindcă asta joci.
 *
 *   node scripts/sieveReport.js
 */
import { loadMainSeasons } from '../src/lib/footballData.js';
import { replaySources } from '../src/bot/replay.js';
import { blend } from '../src/models/ensemble.js';
import { closingProbs } from '../src/lib/clv.js';
import { rankSlate } from '../src/bot/sieve.js';

const LEAGUES = (process.env.SIEVE_LEAGUES ?? 'E0,E1,SP1,I1,D1,F1,N1,P1,T1,B1,SC0').split(',');
const SEASONS = ['2122', '2223', '2324', '2425'];
const TOP = Number(process.env.SIEVE_TOP ?? 4);
const MIN_DAY = Number(process.env.SIEVE_MIN_DAY ?? 15);
const TRAIN_MIN = 380, WINDOW = 1140;
const OUT = ['1', 'X', '2'];
const norm = (s) => { const t = s.home_win + s.draw + s.away_win; return [s.home_win / t, s.draw / t, s.away_win / t]; };

/* ---------- predicțiile walk-forward ---------- */
const all = [];
for (const lg of LEAGUES) {
  let rows;
  try { rows = (await loadMainSeasons(lg, ['2021', ...SEASONS])).filter((r) => r.books?.b365?.close); }
  catch { continue; }
  let n = 0;
  for (let i = TRAIN_MIN; i < rows.length; i++) {
    const t = rows[i];
    const src = replaySources({ history: rows.slice(Math.max(0, i - WINDOW), i), target: t, simulations: 2000, seed: i });
    if (!src) continue;
    const e = blend({ dixonColes: src.dixonColes, ...(src.elo ? { elo: src.elo } : {}) }, { dixonColes: 0.6, elo: 0.4 });
    // Piața = Bet365 la închidere, de-vigat: o casă „moale", ca a ta.
    all.push({ league: lg, date: t.date, outcome: t.outcome, model: norm(e), market: closingProbs(t.books.b365.close),
      odds: t.books.b365.close });
    n++;
  }
  console.error(`${lg}: ${n} meciuri`);
}

/* ---------- pe zile ---------- */
const byDay = new Map();
for (const m of all) { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push(m); }
const days = [...byDay.entries()].filter(([, ms]) => ms.length >= MIN_DAY);
console.error(`\n${days.length} zile cu cel puțin ${MIN_DAY} meciuri (media ${(days.reduce((s, [, m]) => s + m.length, 0) / days.length).toFixed(0)}/zi)\n`);

const argmax = (a) => a.indexOf(Math.max(...a));
const SCHEMES = {
  'A. doar piața': (ms) => ms.map((m) => ({ m, p: m.market, k: argmax(m.market) }))
    .sort((a, b) => b.p[b.k] - a.p[a.k]).slice(0, TOP),
  'B. doar modelul': (ms) => ms.map((m) => ({ m, p: m.model, k: argmax(m.model) }))
    .sort((a, b) => b.p[b.k] - a.p[a.k]).slice(0, TOP),
  // Varianta respinsă, păstrată ca referință: piață ajustată de model cu ±3pp.
  'C. piață+model ±3pp': (ms) => ms.map((m) => {
    const raw = m.market.map((x, i) => Math.max(0.001, x + Math.max(-0.03, Math.min(0.03, m.model[i] - x))));
    const t = raw.reduce((a, b) => a + b, 0);
    const p = raw.map((x) => x / t);
    return { m, p, k: argmax(p) };
  }).sort((a, b) => b.p[b.k] - a.p[a.k]).slice(0, TOP),
  // Sita din producție: trebuie să coincidă cu A.
  'D. sita (producție)': (ms) => rankSlate(ms, { top: TOP, minProb: 0.5 }).play
    .map((m) => ({ m, p: m.sieve.probs, k: argmax(m.sieve.probs) })),
};

console.log(`\n${'═'.repeat(100)}`);
console.log(`SITA — top ${TOP} pe zi, ${days.length} zile cu ≥${MIN_DAY} meciuri, sezoanele 2021/22–2024/25`);
console.log('═'.repeat(100));
console.log('metodă'.padEnd(18) + 'pick-uri'.padStart(9) + 'au ieșit'.padStart(10) + 'declarat'.padStart(10) +
  'diferență'.padStart(11) + 'cotă med.'.padStart(10) + 'ROI'.padStart(8) + 'bilet 2'.padStart(9) + 'bilet 3'.padStart(9));
console.log('─'.repeat(100));

for (const [name, pickFn] of Object.entries(SCHEMES)) {
  let n = 0, wins = 0, declared = 0, profit = 0, oddsSum = 0, s2 = 0, s2w = 0, s3 = 0, s3w = 0;
  for (const [, ms] of days) {
    const picks = pickFn(ms);
    const hits = picks.map(({ m, k }) => m.outcome === OUT[k]);
    picks.forEach(({ m, p, k }, i) => {
      n++; declared += p[k]; oddsSum += m.odds[k];
      if (hits[i]) { wins++; profit += m.odds[k] - 1; } else profit -= 1;
    });
    // Biletele pe care le joci: primele 2, respectiv primele 3 pick-uri ale zilei.
    if (hits.length >= 2) { s2++; if (hits[0] && hits[1]) s2w++; }
    if (hits.length >= 3) { s3++; if (hits[0] && hits[1] && hits[2]) s3w++; }
  }
  const hit = wins / n * 100, dec = declared / n * 100;
  console.log(
    name.padEnd(18) + String(n).padStart(9) + `${hit.toFixed(1)}%`.padStart(10) + `${dec.toFixed(1)}%`.padStart(10) +
    `${(hit - dec >= 0 ? '+' : '')}${(hit - dec).toFixed(1)}pp`.padStart(11) + (oddsSum / n).toFixed(2).padStart(10) +
    `${(profit / n * 100).toFixed(1)}%`.padStart(8) +
    `${(s2w / s2 * 100).toFixed(1)}%`.padStart(9) + `${(s3w / s3 * 100).toFixed(1)}%`.padStart(9)
  );
}
console.log('─'.repeat(100));

// Merită dezacordul modelului afișat ca AVERTISMENT peste pick-urile pieței?
// Contează doar dacă pick-ul pieței iese mai rar când modelul nu e de acord.
const agree = { n: 0, w: 0 }, disagree = { n: 0, w: 0 };
for (const [, ms] of days) {
  for (const { m, k } of SCHEMES['A. doar piața'](ms)) {
    const g = argmax(m.model) === k ? agree : disagree;
    g.n++; if (m.outcome === OUT[k]) g.w++;
  }
}
const pr = (g) => (g.n ? `${(g.w / g.n * 100).toFixed(1)}% din ${g.n}` : '—');
console.log(`\nPick-urile pieței (top ${TOP}/zi), după acordul modelului:`);
console.log(`  modelul e de acord:     ${pr(agree)}`);
console.log(`  modelul NU e de acord:  ${pr(disagree)}`);
console.log('„declarat" = probabilitatea pe care o dădea metoda. „diferență" = cât de onestă a fost (0 = perfect).');
console.log('„bilet 2/3" = cât de des au ieșit ÎMPREUNĂ primele 2, respectiv 3 pick-uri ale zilei.\n');
