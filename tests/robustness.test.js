import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyBlocks, blockBootstrapRoi, profitConcentration,
  signFlipPValue, conservativeEv, promotionVerdict,
} from '../src/lib/robustness.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const bet = (date, hit, odds = 2) => ({ date, hit, odds });

test('dailyBlocks agregă pariurile din aceeași zi', () => {
  const d = dailyBlocks([
    bet('2025-01-01', true, 2.5), bet('2025-01-01', false),
    bet('2025-01-02', true, 2),
  ]);
  assert.equal(d.length, 2);
  assert.equal(d[0].n, 2);
  close(d[0].profit, 1.5 - 1);
  close(d[1].profit, 1);
});

test('dailyBlocks folosește profitul explicit când există (AH, push-uri)', () => {
  const d = dailyBlocks([{ date: '2025-01-01', profit: 0.45 }, { date: '2025-01-01', profit: 0 }]);
  close(d[0].profit, 0.45);
});

test('blockBootstrapRoi e determinist și încadrează media', () => {
  const bets = [];
  for (let i = 0; i < 200; i++) bets.push(bet(`2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, i % 2 === 0, 2.2));
  const a = blockBootstrapRoi(bets);
  const b = blockBootstrapRoi(bets);
  assert.equal(a.p05, b.p05, 'seed fix ⇒ reproductibil');
  assert.ok(a.p05 <= a.p50 && a.p50 <= a.p95);
  close(a.roi_pct, 10, 0.01);
});

test('bootstrap pe zile dă interval mai LARG decât pe pariuri când ziua e corelată', () => {
  // 20 de zile, 10 pariuri pe zi, toate cu același rezultat în ziua lor —
  // corelare maximă. Pe pariuri pare 200 de observații; de fapt sunt 20.
  const bets = [];
  for (let d = 0; d < 20; d++) {
    const win = d % 2 === 0;
    for (let k = 0; k < 10; k++) bets.push(bet(`2025-01-${String(d + 1).padStart(2, '0')}`, win, 2.0));
  }
  const byDay = blockBootstrapRoi(bets);
  const byBet = blockBootstrapRoi(bets.map((b, i) => ({ ...b, date: `z${i}` })));
  const width = (r) => r.p95 - r.p05;
  assert.ok(width(byDay) > width(byBet) * 2,
    `blocuri ${width(byDay).toFixed(1)} vs pariuri ${width(byBet).toFixed(1)} — corelarea trebuie să lărgească intervalul`);
  assert.equal(byDay.days, 20);
});

test('profitConcentration prinde profitul adus de câteva nimereli', () => {
  // Un câștig la cota 20 și în rest pierderi mici: tot profitul e dintr-un pariu.
  const bets = [bet('d1', true, 20), ...Array.from({ length: 10 }, (_, i) => bet(`d${i + 2}`, false))];
  const c = profitConcentration(bets, 5);
  assert.ok(c.top_k_share > 1, 'top-5 depășește profitul total: restul sunt pierderi');
  assert.equal(profitConcentration([bet('d1', false)]).top_k_share, null, 'fără profit nu există concentrare');
});

test('signFlipPValue: profit consistent ⇒ p mic, zgomot ⇒ p mare', () => {
  const steady = Array.from({ length: 60 }, (_, i) => bet(`d${i}`, true, 1.5));
  assert.ok(signFlipPValue(steady) < 0.01);
  const noise = Array.from({ length: 60 }, (_, i) => bet(`d${i}`, i % 2 === 0, 2.0));
  assert.ok(signFlipPValue(noise) > 0.2, 'profit zero ⇒ nu se distinge de aleator');
});

test('conservativeEv e mereu sub EV-ul nominal', () => {
  const nominal = 0.55 * 2.0 - 1;
  const cons = conservativeEv({ prob: 0.55, odds: 2.0 });
  assert.ok(cons < nominal);
  // 0.54 × (1 + 1 × 0.98) − 1 = 0.0692
  close(cons, 0.54 * 1.98 - 1, 1e-9);
  assert.equal(conservativeEv({ prob: 1.2, odds: 2 }), null);
});

test('conservativeEv poate transforma un EV pozitiv în negativ', () => {
  // Nominal +1%, dar după marjă și haircut dispare.
  assert.ok(0.505 * 2.0 - 1 > 0);
  assert.ok(conservativeEv({ prob: 0.505, odds: 2.0 }) < 0);
});

test('promotionVerdict cere toate condițiile', () => {
  const few = Array.from({ length: 50 }, (_, i) => bet(`d${i}`, true, 1.5));
  const v = promotionVerdict(few);
  assert.equal(v.verdict, 'FAIL');
  assert.ok(v.reasons.some((r) => r.includes('n=50')));
});

test('promotionVerdict trece doar pe profit robust, pe multe zile', () => {
  const bets = [];
  for (let i = 0; i < 300; i++) bets.push(bet(`2025-d${Math.floor(i / 3)}`, i % 5 !== 0, 1.5));
  const v = promotionVerdict(bets);
  assert.equal(v.verdict, 'PASS', v.reasons.join('; '));
});

test('CLV la închidere nu se raportează — ar fi circular', async () => {
  // Regresie pentru capcana prinsă de două ori: dacă filtrezi pe
  // „cotă × p_referință − 1 ≥ prag" și referința e închiderea, atunci CLV-ul
  // față de închidere e exact aceeași cantitate. Scriptul trebuie să-l ascundă.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../scripts/namedBookGap.js', import.meta.url), 'utf8');
  assert.match(src, /st\.ref !== 'close'/, 'CLV trebuie calculat doar când referința nu e închiderea');
});
