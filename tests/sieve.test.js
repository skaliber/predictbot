import test from 'node:test';
import assert from 'node:assert/strict';
import { anchoredProbs, sieveScore, rankSlate } from '../src/bot/sieve.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('anchoredProbs: modelul poate muta piața cu cel mult 3 puncte', () => {
  const market = [0.50, 0.30, 0.20];
  const model = [0.70, 0.20, 0.10]; // modelul vrea +20 puncte pe gazde
  const p = anchoredProbs(market, model);
  close(p.reduce((a, b) => a + b, 0), 1);
  // Gazdele urcă, dar nu cu mult peste 3 puncte (după re-normalizare).
  assert.ok(p[0] > 0.50 && p[0] < 0.55, `gazde ${p[0]}`);
});

test('anchoredProbs re-normalizează — nu fabrică probabilitate', () => {
  // Toate trei ajustate în sus: fără re-normalizare suma ar depăși 1.
  const p = anchoredProbs([0.40, 0.30, 0.30], [0.50, 0.40, 0.40]);
  close(p.reduce((a, b) => a + b, 0), 1);
});

test('anchoredProbs cade pe ce există', () => {
  assert.deepEqual(anchoredProbs(null, [0.5, 0.3, 0.2]), [0.5, 0.3, 0.2]);
  assert.deepEqual(anchoredProbs([0.5, 0.3, 0.2], null), [0.5, 0.3, 0.2]);
  assert.equal(anchoredProbs(null, null), null);
});

test('sieveScore penalizează puternic dezacordul model–piață', () => {
  const agree = sieveScore({ market: [0.60, 0.25, 0.15], model: [0.62, 0.24, 0.14] });
  const disagree = sieveScore({ market: [0.60, 0.25, 0.15], model: [0.30, 0.25, 0.45] });
  assert.ok(agree.score > disagree.score + 20, `${agree.score} vs ${disagree.score}`);
  assert.ok(disagree.reasons.some((r) => r.startsWith('modelul zice')));
  assert.ok(agree.reasons.includes('model și piață de acord'));
});

test('sieveScore: pick-ul urmează piața ancorată, nu modelul brut', () => {
  // Modelul preferă oaspeții, dar piața e clar pe gazde; ajustarea e plafonată.
  const s = sieveScore({ market: [0.65, 0.20, 0.15], model: [0.30, 0.20, 0.50] });
  assert.equal(s.pick, '1', 'piața câștigă, modelul doar ajustează');
});

test('sieveScore: fără cote e penalizat, dar tot scorat', () => {
  const s = sieveScore({ market: null, model: [0.70, 0.20, 0.10] });
  assert.ok(s.score < 70);
  assert.ok(s.reasons[0].includes('fără cote'));
});

test('sieveScore: cota corectă e inversul probabilității', () => {
  const s = sieveScore({ market: [0.80, 0.12, 0.08], model: null });
  close(s.fairOdds, 1 / s.prob);
});

const m = (id, market, model) => ({ id, market, model });

test('rankSlate alege primii 4 și lasă restul, cu motiv', () => {
  const slate = [
    m('a', [0.80, 0.12, 0.08], [0.81, 0.11, 0.08]),
    m('b', [0.75, 0.15, 0.10], [0.74, 0.16, 0.10]),
    m('c', [0.70, 0.18, 0.12], [0.71, 0.17, 0.12]),
    m('d', [0.66, 0.20, 0.14], [0.66, 0.20, 0.14]),
    m('e', [0.62, 0.22, 0.16], [0.62, 0.22, 0.16]),
  ];
  const { play, leave } = rankSlate(slate, { top: 4 });
  assert.deepEqual(play.map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.equal(leave.length, 1);
  assert.equal(leave[0].leaveReason, 'în afara primelor candidați');
});

test('rankSlate nu completează lista cu candidați slabi', () => {
  const { play, leave } = rankSlate([
    m('bun', [0.75, 0.15, 0.10], [0.75, 0.15, 0.10]),
    m('slab', [0.40, 0.32, 0.28], [0.40, 0.32, 0.28]),
  ], { top: 4, minProb: 0.5 });
  assert.equal(play.length, 1, 'mai bine 1 bun decât 2 cu unul slab');
  assert.match(leave[0].leaveReason, /sub prag/);
});

test('rankSlate lasă conflictele chiar dacă au probabilitate mare', () => {
  const { play, leave } = rankSlate([
    m('conflict', [0.80, 0.12, 0.08], [0.25, 0.20, 0.55]),
    m('ok', [0.60, 0.25, 0.15], [0.61, 0.24, 0.15]),
  ], { top: 4 });
  assert.deepEqual(play.map((x) => x.id), ['ok']);
  assert.match(leave.find((x) => x.id === 'conflict').leaveReason, /modelul zice/);
});
