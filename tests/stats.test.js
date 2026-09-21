import test from 'node:test';
import assert from 'node:assert/strict';
import { wilsonInterval, tierTable, calibrationBuckets, flagTable } from '../src/lib/stats.js';
import { formBefore, sampleFor } from '../src/bot/replay.js';

const close = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Wilson: valori de referință cunoscute', () => {
  // 50/100 ⇒ ~40.4–59.6% (valoare standard din literatură).
  const [lo, hi] = wilsonInterval(50, 100);
  close(lo, 40.4); close(hi, 59.6);
  // Eșantion mic: intervalul e larg, dar rămâne în [0,100].
  const [lo2, hi2] = wilsonInterval(4, 5);
  assert.ok(lo2 > 0 && hi2 <= 100 && hi2 > lo2);
  assert.ok(hi2 - lo2 > 40, 'la n=5 intervalul trebuie să fie foarte larg');
});

test('Wilson: cazuri extreme nu ies din interval', () => {
  const [lo, hi] = wilsonInterval(0, 10);
  assert.equal(lo, 0);
  assert.ok(hi > 0 && hi < 50);
  const [lo2, hi2] = wilsonInterval(10, 10);
  assert.ok(lo2 > 50 && lo2 < 100);
  assert.equal(hi2, 100);
  assert.deepEqual(wilsonInterval(0, 0), [0, 0]);
});

test('Wilson se îngustează cu eșantionul', () => {
  const w = (n) => { const [lo, hi] = wilsonInterval(n / 2, n); return hi - lo; };
  assert.ok(w(1000) < w(100));
  assert.ok(w(100) < w(20));
});

const row = (tier, hit, prob, odds, kelly = 0.02, flags = []) => ({
  tier, hit, prob_pct: prob, odds, kelly_stake: kelly, flags,
});

test('tierTable calculează rată, ROI flat și ROI Kelly', () => {
  const rows = [
    row('SAFE', true, 70, 2.0), row('SAFE', true, 70, 2.0),
    row('SAFE', false, 70, 2.0), row('SAFE', false, 70, 2.0),
    row('RISKY', false, 55, 3.0),
  ];
  const t = tierTable(rows);
  const safe = t.find((x) => x.tier === 'SAFE');
  assert.equal(safe.n, 4);
  assert.equal(safe.wins, 2);
  close(safe.hit_rate_pct, 50);
  // Flat: +1 +1 −1 −1 = 0 pe 4 pariuri ⇒ 0%
  close(safe.roi_flat_pct, 0);
  // Kelly: (0.02 − 0.02) × 2 = 0 profit pe 0.08 mizat ⇒ 0%
  close(safe.roi_kelly_pct, 0);
  assert.equal(t.find((x) => x.tier === 'RISKY').n, 1);
  // Ordinea e SAFE → MODERATE → RISKY, nu alfabetică.
  assert.deepEqual(t.map((x) => x.tier), ['SAFE', 'RISKY']);
});

test('tierTable: ROI corect când cotele diferă', () => {
  const rows = [row('SAFE', true, 70, 3.0), row('SAFE', false, 70, 3.0)];
  const safe = tierTable(rows)[0];
  // Flat: +2 −1 = +1 pe 2 pariuri ⇒ +50%
  close(safe.roi_flat_pct, 50);
});

test('tierTable ignoră ROI când lipsesc cotele', () => {
  const rows = [row('SAFE', true, 70, null, 0), row('SAFE', false, 70, null, 0)];
  const safe = tierTable(rows)[0];
  assert.equal(safe.roi_flat_pct, null);
  assert.equal(safe.roi_kelly_pct, null);
  assert.equal(safe.n, 2, 'rata de reușită se calculează oricum');
  close(safe.hit_rate_pct, 50);
});

test('calibrationBuckets detectează supraîncrederea', () => {
  // Declarat ~75%, iese în 50% din cazuri ⇒ eroare negativă mare.
  const rows = [
    row('SAFE', true, 75, 2), row('SAFE', false, 75, 2),
    row('SAFE', true, 76, 2), row('SAFE', false, 74, 2),
  ];
  const b = calibrationBuckets(rows).find((x) => x.bucket === '70–80%');
  assert.equal(b.n, 4);
  close(b.mean_prob_pct, 75);
  close(b.actual_pct, 50);
  assert.ok(b.error_pp < -20, `supraîncredere: ${b.error_pp}pp`);
});

test('calibrationBuckets detectează calibrarea bună', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row('SAFE', i < 7, 70, 2));
  const b = calibrationBuckets(rows).find((x) => x.bucket === '70–80%');
  close(b.actual_pct, 70);
  assert.ok(Math.abs(b.error_pp) < 1, 'calibrat');
});

test('calibrationBuckets sare peste bucket-urile goale', () => {
  const b = calibrationBuckets([row('SAFE', true, 75, 2)]);
  assert.equal(b.length, 1);
  assert.equal(b[0].bucket, '70–80%');
});

test('flagTable măsoară efectul real al unui flag', () => {
  const F = [{ code: 'POOR_FORM_PICK', severity: 'exclude' }];
  const rows = [
    // Cu flag: 1 din 4 iese.
    row('RISKY', true, 60, 2, 0, F), row('RISKY', false, 60, 2, 0, F),
    row('RISKY', false, 60, 2, 0, F), row('RISKY', false, 60, 2, 0, F),
    // Fără flag: 3 din 4 ies.
    row('SAFE', true, 60, 2), row('SAFE', true, 60, 2),
    row('SAFE', true, 60, 2), row('SAFE', false, 60, 2),
  ];
  const f = flagTable(rows).find((x) => x.code === 'POOR_FORM_PICK');
  assert.equal(f.n, 4);
  close(f.hit_with_pct, 25);
  close(f.hit_without_pct, 75);
  close(f.delta_pp, -50);
  assert.ok(f.delta_pp < 0, 'un flag util semnalează pick-uri care ies mai rar');
});

test('flagTable sortează de la cel mai util la cel mai inutil', () => {
  const A = [{ code: 'BUN' }], B = [{ code: 'INUTIL' }];
  const rows = [
    row('RISKY', false, 60, 2, 0, A), row('RISKY', false, 60, 2, 0, A),
    row('RISKY', true, 60, 2, 0, B), row('RISKY', true, 60, 2, 0, B),
    row('SAFE', true, 60, 2), row('SAFE', false, 60, 2),
  ];
  const t = flagTable(rows);
  assert.equal(t[0].code, 'BUN', 'delta cel mai negativ primul');
});

test('flagTable ignoră flag-urile prezente peste tot sau nicăieri', () => {
  const F = [{ code: 'PESTE_TOT' }];
  const rows = [row('SAFE', true, 60, 2, 0, F), row('SAFE', false, 60, 2, 0, F)];
  assert.deepEqual(flagTable(rows), [], 'fără grup de comparație nu se poate măsura');
});

// ---- replay: nu vede viitorul ----

const hist = [
  { home: 'A', away: 'B', homeGoals: 2, awayGoals: 0, date: '2026-01-01' },
  { home: 'B', away: 'A', homeGoals: 1, awayGoals: 1, date: '2026-01-08' },
  { home: 'A', away: 'C', homeGoals: 0, awayGoals: 3, date: '2026-01-15' },
  { home: 'C', away: 'A', homeGoals: 2, awayGoals: 2, date: '2026-01-22' },
];

test('formBefore ia ultimele rezultate, cele mai recente primele', () => {
  const f = formBefore(hist, 'A', 5);
  assert.equal(f.length, 4);
  assert.deepEqual(f.map((x) => x.result), ['D', 'L', 'D', 'W']);
  assert.equal(f[0].goals_for, 2, 'A a marcat 2 în ultimul (în deplasare la C)');
  assert.equal(f[0].goals_against, 2);
});

test('formBefore respectă limita', () => {
  assert.equal(formBefore(hist, 'A', 2).length, 2);
  assert.deepEqual(formBefore(hist, 'A', 2).map((x) => x.result), ['D', 'L']);
});

test('formBefore pentru echipă necunoscută e gol', () => {
  assert.deepEqual(formBefore(hist, 'Z'), []);
});

test('sampleFor numără meciurile echipei, acasă și în deplasare', () => {
  assert.equal(sampleFor(hist, 'A'), 4);
  assert.equal(sampleFor(hist, 'B'), 2);
  assert.equal(sampleFor(hist, 'C'), 2);
  assert.equal(sampleFor(hist, 'Z'), 0);
});
