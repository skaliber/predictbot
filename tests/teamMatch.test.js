import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, tokens, nameSimilarity, matchFixtures } from '../src/lib/teamMatch.js';

test('normalizeName elimină diacriticele și punctuația', () => {
  assert.equal(normalizeName('FC Rapid București'), 'fc rapid bucuresti');
  assert.equal(normalizeName("Nott'm Forest"), 'nottm forest');
  assert.equal(normalizeName('Oțelul Galați'), 'otelul galati');
});

test('tokens ignoră cuvintele care nu identifică echipa', () => {
  assert.deepEqual(tokens('FC Rapid Bucuresti'), ['rapid', 'bucuresti']);
  assert.deepEqual(tokens('Sport Lisboa e Benfica'), ['lisboa', 'benfica']);
  assert.deepEqual(tokens('Arsenal FC'), ['arsenal']);
});

test('nameSimilarity recunoaște aceeași echipă sub nume diferite', () => {
  assert.equal(nameSimilarity('FC Rapid Bucuresti', 'Rapid Bucuresti'), 1);
  assert.equal(nameSimilarity('Sport Lisboa e Benfica', 'Benfica'), 1);
  assert.equal(nameSimilarity('Arsenal FC', 'Arsenal'), 1);
  assert.equal(nameSimilarity('FC Universitatea Cluj', 'U. Cluj') >= 0.5, true);
  assert.ok(nameSimilarity('Nottingham Forest FC', "Nott'm Forest") >= 0.5, 'prefixul „nott"');
});

test('nameSimilarity distinge echipe diferite', () => {
  assert.ok(nameSimilarity('Arsenal FC', 'Chelsea FC') < 0.5);
  assert.ok(nameSimilarity('FC Rapid Bucuresti', 'FCSB') < 0.5);
});

const m = (date, home, away, extra = {}) => ({ date, home, away, ...extra });

test('matchFixtures lipește pe dată și nume', () => {
  const left = [m('2026-09-12', 'FC Rapid Bucuresti', 'FC Voluntari')];
  const right = [
    m('2026-09-12', 'Rapid Bucuresti', 'Voluntari', { id: 'ok' }),
    m('2026-09-12', 'FCSB', 'Petrolul', { id: 'altul' }),
  ];
  const { pairs } = matchFixtures(left, right);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].right.id, 'ok');
});

test('matchFixtures tolerează o zi diferență (fus orar)', () => {
  const { pairs } = matchFixtures(
    [m('2026-09-12', 'Arsenal FC', 'Chelsea FC')],
    [m('2026-09-13', 'Arsenal', 'Chelsea')]
  );
  assert.equal(pairs.length, 1);
});

test('matchFixtures nu lipește peste două zile distanță', () => {
  const { pairs, unmatched } = matchFixtures(
    [m('2026-09-12', 'Arsenal FC', 'Chelsea FC')],
    [m('2026-09-15', 'Arsenal', 'Chelsea')]
  );
  assert.equal(pairs.length, 0);
  assert.equal(unmatched, 1);
});

test('matchFixtures cere ambele echipe, nu doar una', () => {
  // Gazda se potrivește, oaspetele nu ⇒ nu e același meci.
  const { pairs } = matchFixtures(
    [m('2026-09-12', 'Arsenal FC', 'Chelsea FC')],
    [m('2026-09-12', 'Arsenal', 'Everton')]
  );
  assert.equal(pairs.length, 0);
});

test('matchFixtures refuză potrivirile ambigue', () => {
  // Două meciuri la fel de plauzibile ⇒ nu ghicim.
  const { pairs, ambiguous } = matchFixtures(
    [m('2026-09-12', 'United', 'City')],
    [m('2026-09-12', 'United', 'City', { id: 'a' }), m('2026-09-12', 'United', 'City', { id: 'b' })]
  );
  assert.equal(pairs.length, 0);
  assert.equal(ambiguous, 1);
});
