import test from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToDecimal, decimalToAmerican, decimalToProbability, probabilityToDecimal,
  overround, devig, devigProportional, devigShin,
} from '../src/betting/odds.js';
import { findEdge, kelly, evaluateBet, findArbitrage, parlayAnalysis } from '../src/betting/kelly.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('conversii american ↔ zecimal', () => {
  close(americanToDecimal(-150), 1 + 100 / 150);
  close(americanToDecimal(130), 2.3);
  assert.equal(decimalToAmerican(2.3), 130);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.throws(() => americanToDecimal(0), /invalidă/);
  assert.throws(() => decimalToAmerican(0.9), /invalidă/);
});

test('probabilitate ↔ cotă zecimală', () => {
  close(decimalToProbability(2), 0.5);
  close(probabilityToDecimal(0.25), 4);
  assert.throws(() => probabilityToDecimal(0), /invalidă/);
  assert.throws(() => probabilityToDecimal(1), /invalidă/);
});

test('overround detectează marja bookmakerului', () => {
  const r = overround([2.0, 2.0]);
  close(r.total_implied, 1);
  close(r.vig_pct, 0);
  const vigged = overround([1.9, 1.9]);
  assert.ok(vigged.vig_pct > 5 && vigged.vig_pct < 6);
});

test('de-vig proporțional normalizează la 1', () => {
  const fair = devigProportional([2.10, 3.40, 3.60]);
  close(fair.reduce((s, p) => s + p, 0), 1, 1e-9);
  assert.ok(fair[0] > fair[1] && fair[1] > fair[2]);
});

test('de-vig Shin normalizează la 1 și diferă de proporțional pe piețe dezechilibrate', () => {
  const odds = [1.25, 6.0, 12.0];
  const shin = devigShin(odds);
  const prop = devigProportional(odds);
  close(shin.reduce((s, p) => s + p, 0), 1, 1e-9);
  // Shin corectează favourite-longshot bias: marja se încarcă mai mult pe outsideri,
  // deci favoritul iese cu o probabilitate fair mai MARE decât la proporțional.
  assert.ok(shin[0] > prop[0], `favorit shin ${shin[0]} trebuie > prop ${prop[0]}`);
  assert.ok(shin[2] < prop[2], `outsider shin ${shin[2]} trebuie < prop ${prop[2]}`);
});

test('devig pe piață fără marjă lasă probabilitățile neschimbate', () => {
  const r = devig([2, 2], { method: 'proportional' });
  close(r.fair_probabilities[0], 0.5);
  close(r.vig_pct, 0);
});

test('devig acceptă cote americane și etichete', () => {
  const r = devig([-150, 130], { format: 'american', labels: ['home', 'away'] });
  close(r.fair_probabilities[0] + r.fair_probabilities[1], 1, 1e-9);
  assert.ok(r.by_label.home > r.by_label.away);
  assert.ok(Math.abs(r.by_label.home - 0.579) < 0.01, `așteptat ~57.9%, primit ${r.by_label.home}`);
});

test('Shin rezolvă z astfel încât probabilitățile să însumeze exact 1', () => {
  for (const odds of [[1.1, 15, 30], [2.05, 3.5, 3.9], [1.02, 40, 90], [3.0, 3.0, 3.0]]) {
    const fair = devigShin(odds);
    close(fair.reduce((s, p) => s + p, 0), 1, 1e-9);
    assert.ok(fair.every((p) => p > 0 && p < 1), `probabilități în (0,1) pentru ${odds}`);
    // Ordinea cotelor trebuie păstrată.
    const order = [...fair.keys()].sort((a, b) => fair[b] - fair[a]);
    const oddsOrder = [...odds.keys()].sort((a, b) => odds[a] - odds[b]);
    assert.deepEqual(order, oddsOrder);
  }
});

test('devig respinge cote sub 1', () => {
  assert.throws(() => devig([0.5, 2]), /> 1/);
});

test('findEdge calculează edge și EV corect', () => {
  // p=0.6 la cota 2.0 ⇒ EV = 0.6*1 - 0.4 = +0.2
  const r = findEdge({ fairProb: 0.6, decimalOdds: 2.0 });
  close(r.edge, 0.1);
  close(r.ev, 0.2);
  assert.equal(r.positive, true);
  const neg = findEdge({ fairProb: 0.4, decimalOdds: 2.0 });
  close(neg.ev, -0.2);
  assert.equal(neg.positive, false);
});

test('findEdge acceptă marketProb în loc de cotă', () => {
  const r = findEdge({ fairProb: 0.58, marketProb: 0.52 });
  close(r.edge, 0.06, 1e-9);
});

test('findEdge respinge input invalid', () => {
  assert.throws(() => findEdge({ fairProb: 1.2, decimalOdds: 2 }), /\(0,1\)/);
  assert.throws(() => findEdge({ fairProb: 0.5 }), /lipsesc/);
});

test('kelly: formula (bp − q)/b', () => {
  // b=1, p=0.6 ⇒ f* = (1*0.6 - 0.4)/1 = 0.2
  const r = kelly({ prob: 0.6, decimalOdds: 2.0 });
  close(r.full_kelly, 0.2);
  close(r.stake, 0.2);
  assert.equal(r.edge_positive, true);
});

test('kelly nu mizează pe edge negativ', () => {
  const r = kelly({ prob: 0.4, decimalOdds: 2.0 });
  assert.ok(r.full_kelly < 0);
  assert.equal(r.stake, 0);
  assert.equal(r.edge_positive, false);
});

test('kelly fracționat și plafonat', () => {
  const quarter = kelly({ prob: 0.6, decimalOdds: 2.0, fraction: 0.25 });
  close(quarter.stake, 0.05);
  const capped = kelly({ prob: 0.9, decimalOdds: 3.0, fraction: 1, cap: 0.05 });
  assert.equal(capped.stake, 0.05);
  assert.equal(capped.capped, true);
});

test('evaluateBet combină edge + miză', () => {
  const r = evaluateBet({ fairProb: 0.6, decimalOdds: 2.0, kellyFraction: 0.25, maxStake: 0.05 });
  close(r.ev_pct, 20);
  close(r.kelly_stake, 0.05);
  close(r.full_kelly, 0.2);
});

test('findArbitrage detectează profit garantat', () => {
  const arb = findArbitrage([2.10, 2.10], { labels: ['a', 'b'] });
  assert.equal(arb.arbitrage, true);
  assert.ok(arb.roi_pct > 4.9 && arb.roi_pct < 5.1);
  close(arb.stakes.reduce((s, x) => s + x.stake_fraction, 0), 1, 1e-9);

  const none = findArbitrage([1.9, 1.9]);
  assert.equal(none.arbitrage, false);
  assert.equal(none.roi_pct, 0);
  assert.deepEqual(none.stakes, []);
});

test('parlayAnalysis înmulțește probabilitățile picioarelor', () => {
  const r = parlayAnalysis({ legs: [0.5, 0.5], decimalOdds: 5.0 });
  close(r.combined_prob, 0.25);
  close(r.ev, 0.25 * 4 - 0.75);
  assert.equal(r.legs, 2);
});
