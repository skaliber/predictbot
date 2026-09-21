import test from 'node:test';
import assert from 'node:assert/strict';
import {
  doubleChanceOdds, doubleChanceHit, accumulator,
  theoreticalAccumulatorRoi, lineMove,
} from '../src/lib/combinedMarkets.js';

const close = (a, b, eps = 0.001) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('doubleChanceOdds replică exact prețul din 1X2', () => {
  // Cote 2.0 / 3.5 / 4.0. Dubla 1X = 1/(0.5 + 0.2857) = 1.2727
  const o = [2.0, 3.5, 4.0];
  close(doubleChanceOdds(o, '1X'), 1 / (1 / 2 + 1 / 3.5));
  close(doubleChanceOdds(o, 'X2'), 1 / (1 / 3.5 + 1 / 4));
  close(doubleChanceOdds(o, '12'), 1 / (1 / 2 + 1 / 4));
  // Dubla trebuie să fie mereu sub cota simplă cea mai mică din pereche.
  assert.ok(doubleChanceOdds(o, '1X') < Math.min(o[0], o[1]));
});

test('doubleChanceOdds: cu cât piața e mai echilibrată, cu atât dubla e mai mică', () => {
  const echilibrat = doubleChanceOdds([3, 3, 3], '1X');
  const dezechilibrat = doubleChanceOdds([1.2, 6, 15], '1X');
  assert.ok(dezechilibrat < echilibrat, 'favorit clar ⇒ dublă foarte mică');
  close(echilibrat, 1.5);
});

test('doubleChanceOdds respinge input invalid', () => {
  assert.equal(doubleChanceOdds([2, 3, 4], 'ABC'), null);
  assert.equal(doubleChanceOdds([0.5, 3, 4], '1X'), null);
  assert.equal(doubleChanceOdds(null, '1X'), null);
});

test('doubleChanceHit acoperă ambele rezultate', () => {
  assert.equal(doubleChanceHit('1X', '1'), true);
  assert.equal(doubleChanceHit('1X', 'X'), true);
  assert.equal(doubleChanceHit('1X', '2'), false);
  assert.equal(doubleChanceHit('X2', '2'), true);
  assert.equal(doubleChanceHit('12', 'X'), false);
  assert.equal(doubleChanceHit('ABC', '1'), null);
});

test('accumulator înmulțește cotele și cere toate picioarele', () => {
  const legs = [{ odds: 1.5, hit: true }, { odds: 1.4, hit: true }, { odds: 1.6, hit: true }];
  const a = accumulator(legs);
  close(a.combined_odds, 1.5 * 1.4 * 1.6);
  assert.equal(a.hit, true);
  close(a.profit, 1.5 * 1.4 * 1.6 - 1);

  const oneMiss = accumulator([...legs.slice(0, 2), { odds: 1.6, hit: false }]);
  assert.equal(oneMiss.hit, false);
  assert.equal(oneMiss.profit, -1, 'un picior ratat pierde toată miza');
});

test('marja se COMPUNE la acumulator, nu se diluează', () => {
  // Afirmația de verificat: dacă fiecare picior pierde 5%, combinația pierde MAI MULT.
  close(theoreticalAccumulatorRoi(-0.05, 1), -0.05);
  close(theoreticalAccumulatorRoi(-0.05, 2), -0.0975);
  close(theoreticalAccumulatorRoi(-0.05, 3), -0.142625);
  close(theoreticalAccumulatorRoi(-0.05, 4), -0.18549, 0.0001);
  // Și invers: dacă fiecare picior ar avea edge pozitiv, se compune la fel.
  assert.ok(theoreticalAccumulatorRoi(0.05, 3) > 0.15);
});

test('accumulator pe listă goală', () => {
  assert.equal(accumulator([]), null);
});

test('lineMove identifică partea spre care s-au mutat banii', () => {
  // Gazdele urcă de la 50% la 56%, oaspeții scad.
  const m = lineMove([0.50, 0.25, 0.25], [0.56, 0.24, 0.20]);
  assert.equal(m.steam, '1');
  close(m.steam_pp, 6, 0.01);
  assert.equal(m.drift, '2');
  close(m.drift_pp, -5, 0.01);
  assert.ok(m.magnitude_pp > 0);
});

test('lineMove pe piață care nu s-a mișcat', () => {
  const m = lineMove([0.5, 0.25, 0.25], [0.5, 0.25, 0.25]);
  close(m.steam_pp, 0);
  close(m.magnitude_pp, 0);
  assert.equal(lineMove(null, [0.5, 0.25, 0.25]), null);
});
