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
