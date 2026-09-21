import test from 'node:test';
import assert from 'node:assert/strict';
import { sieveScore, rankSlate, slipProbability, NO_ODDS_PENALTY } from '../src/bot/sieve.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('sieveScore ordonează pur după piață — modelul nu mută probabilitatea', () => {
  // Validat: orice ajustare de model reordona clasamentul spre alegeri mai slabe.
  const market = [0.60, 0.25, 0.15];
  const withModel = sieveScore({ market, model: [0.80, 0.12, 0.08] });
  const without = sieveScore({ market, model: null });
  assert.equal(withModel.score, without.score, 'modelul nu schimbă scorul când există cote');
  close(withModel.prob, 0.60);
  assert.equal(withModel.source, 'piață');
});

test('sieveScore: pick-ul e al pieței, chiar dacă modelul alege altceva', () => {
  const s = sieveScore({ market: [0.65, 0.20, 0.15], model: [0.25, 0.20, 0.55] });
  assert.equal(s.pick, '1');
  assert.ok(s.notes.some((n) => n.includes('modelul ar alege „2"')), 'dezacordul rămâne ca notă pentru presă');
});

test('sieveScore: fără cote cade pe model, penalizat', () => {
  const s = sieveScore({ market: null, model: [0.70, 0.20, 0.10] });
  close(s.score, 70 - NO_ODDS_PENALTY, 1e-6);
  assert.equal(s.source, 'model');
  assert.ok(s.notes[0].includes('fără cote'));
});

test('sieveScore: cota corectă e inversul probabilității', () => {
  const s = sieveScore({ market: [0.80, 0.12, 0.08], model: null });
  close(s.fairOdds, 1.25);
  assert.equal(sieveScore({ market: null, model: null }), null);
});

const m = (id, market, model = null) => ({ id, market, model });

test('rankSlate ia primele 4 după piață și lasă restul, cu motiv', () => {
  const { play, leave } = rankSlate([
    m('e', [0.62, 0.22, 0.16]), m('a', [0.80, 0.12, 0.08]), m('c', [0.70, 0.18, 0.12]),
    m('b', [0.75, 0.15, 0.10]), m('d', [0.66, 0.20, 0.14]),
  ], { top: 4 });
  assert.deepEqual(play.map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.equal(leave[0].leaveReason, 'în afara primilor candidați');
});

test('rankSlate nu completează lista cu candidați slabi', () => {
  const { play, leave } = rankSlate([m('bun', [0.75, 0.15, 0.10]), m('slab', [0.40, 0.32, 0.28])], { top: 4 });
  assert.deepEqual(play.map((x) => x.id), ['bun']);
  assert.match(leave[0].leaveReason, /sub prag/);
});

test('rankSlate NU mai exclude meciurile cu dezacord model–piață', () => {
  // Validat: pick-ul pieței iese de obicei și când modelul nu e de acord.
  const { play } = rankSlate([m('conflict', [0.80, 0.12, 0.08], [0.25, 0.20, 0.55])], { top: 4 });
  assert.equal(play.length, 1);
});

test('rankSlate: un meci cu cote bate unul fără cote la probabilitate egală', () => {
  const { play } = rankSlate([m('fara', null, [0.72, 0.18, 0.10]), m('cu', [0.70, 0.18, 0.12])], { top: 1 });
  assert.equal(play[0].id, 'cu');
});

test('slipProbability înmulțește probabilitățile picioarelor', () => {
  const { play } = rankSlate([m('a', [0.80, 0.12, 0.08]), m('b', [0.75, 0.15, 0.10]), m('c', [0.70, 0.18, 0.12])]);
  close(slipProbability(play, 2), 0.80 * 0.75);
  close(slipProbability(play, 3), 0.80 * 0.75 * 0.70);
});

test('sieveSlate păstrează dezacordul real model–piață în note', async () => {
  const { sieveSlate } = await import('../src/bot/betslips.js');
  const cand = (id, market, model) => ({
    slug: id, match: { home: id, away: 'x', league: 'L' }, flags: [],
    sieve: sieveScore({ market, model }), sieve_inputs: { market, model },
  });
  const { play } = sieveSlate([
    cand('acord', [0.75, 0.15, 0.10], [0.74, 0.16, 0.10]),
    cand('dezacord', [0.70, 0.18, 0.12], [0.25, 0.20, 0.55]),
  ]);
  const d = play.find((c) => c.slug === 'dezacord');
  assert.ok(d.sieve.notes.some((n) => n.includes('modelul ar alege „2"')),
    `nota de dezacord s-a pierdut: ${JSON.stringify(d.sieve.notes)}`);
  assert.ok(play.find((c) => c.slug === 'acord').sieve.notes.some((n) => n.includes('de acord')));
});

test('sieveSlate exclude rundele de calificare și meciurile fără semnal', async () => {
  const { sieveSlate } = await import('../src/bot/betslips.js');
  const c = (id, code) => ({
    slug: id, match: { home: id }, flags: code ? [{ code }] : [],
    sieve: sieveScore({ market: [0.8, 0.12, 0.08], model: null }), sieve_inputs: { market: [0.8, 0.12, 0.08], model: null },
  });
  const { play } = sieveSlate([c('ok'), c('calif', 'QUALIFYING_ROUND'), c('gol', 'NO_ENSEMBLE')]);
  assert.deepEqual(play.map((x) => x.slug), ['ok']);
});
