import test from 'node:test';
import assert from 'node:assert/strict';
import { brier, rps } from '../scripts/backtest.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Brier: predicție perfectă = 0, complet greșită = 2', () => {
  close(brier([1, 0, 0], '1'), 0);
  close(brier([0, 0, 1], '1'), 2);
  close(brier([1 / 3, 1 / 3, 1 / 3], '1'), (2 / 3) ** 2 + 2 * (1 / 3) ** 2);
});

test('RPS penalizează mai puțin greșelile „apropiate"', () => {
  // Prezis „1", ieșit „X" (vecin) trebuie penalizat mai puțin decât ieșit „2" (opus).
  const p = [0.7, 0.2, 0.1];
  assert.ok(rps(p, 'X') < rps(p, '2'));
  close(rps([1, 0, 0], '1'), 0);
  close(rps([0, 0, 1], '1'), 1);
});

test('RPS al unei predicții uniforme e sub baseline-ul degenerat', () => {
  const uniform = rps([1 / 3, 1 / 3, 1 / 3], 'X');
  assert.ok(uniform > 0 && uniform < 0.3);
});

test('RPS uniform NU e o constantă — depinde de rezultat', () => {
  const U = [1 / 3, 1 / 3, 1 / 3];
  // Egalul e „la mijloc": o predicție uniformă îl ratează mai puțin decât 1 sau 2.
  const rpsDraw = rps(U, 'X');
  const rpsHome = rps(U, '1');
  const rpsAway = rps(U, '2');
  close(rpsDraw, 1 / 9);
  close(rpsHome, 5 / 18);
  close(rpsAway, 5 / 18);
  assert.ok(rpsDraw < rpsHome, 'a lua egalul ca baseline uniform e mai ieftin');
  close(rpsHome, rpsAway, 1e-12); // simetric între gazde și oaspeți
  // Media pe un set realist e sub valoarea extremă — de aceea nu se hardcodează.
  const mix = (75 * rpsHome + 58 * rpsDraw + 57 * rpsAway) / 190;
  assert.ok(mix < rpsHome, `media ${mix} trebuie sub extrema ${rpsHome}`);
  assert.ok(Math.abs(mix - 0.227) < 0.005, `media reală ≈ 0.227, primit ${mix}`);
});

test('Brier uniform ESTE constant', () => {
  const U = [1 / 3, 1 / 3, 1 / 3];
  close(brier(U, '1'), 2 / 3);
  close(brier(U, 'X'), 2 / 3);
  close(brier(U, '2'), 2 / 3);
});
