import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toDoubleChance, pairFor, pairProbability, ENABLED, MIN_CONFIDENCE } from '../src/bot/doubleChance.js';
import { runBot } from '../src/bot/botLogic.js';

const bundle = JSON.parse(readFileSync(new URL('./fixtures/match-bundle.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(bundle));
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('fallback-ul e OPRIT implicit — modul de bază nu pariază', () => {
  assert.equal(ENABLED, false, 'ALLOW_DOUBLE_CHANCE_FALLBACK trebuie să fie fals implicit');
  assert.equal(MIN_CONFIDENCE, 60);
});

test('pairFor alege perechea după partea mai puternică', () => {
  assert.equal(pairFor({ homeWinPct: 65, awayWinPct: 15 }), '1X');
  assert.equal(pairFor({ homeWinPct: 15, awayWinPct: 55 }), 'X2');
  assert.equal(pairFor({ homeWinPct: NaN, awayWinPct: 20 }), null);
});

test('pairProbability adună corect cele două rezultate', () => {
  const p = { homeWinPct: 65, drawPct: 20, awayWinPct: 15 };
  close(pairProbability('1X', p), 85);
  close(pairProbability('X2', p), 35);
  assert.equal(pairProbability('12', p), null);
});

const pick1x2 = (prob) => ({ market: '1x2', selection: '1', model_prob_pct: prob, book_odds: 1.8 });
const probs = { homeWinPct: 66, drawPct: 22, awayWinPct: 12 };
const odds = [1.8, 3.6, 4.5];

test('conversia nu se face când flagul e oprit', () => {
  assert.equal(toDoubleChance({ pick: pick1x2(66), probs, odds1x2: odds, enabled: false }), null);
});

test('conversia nu se face sub pragul de încredere', () => {
  assert.equal(toDoubleChance({ pick: pick1x2(55), probs, odds1x2: odds, enabled: true }), null);
  assert.ok(toDoubleChance({ pick: pick1x2(60), probs, odds1x2: odds, enabled: true }), 'exact la prag se aplică');
});

test('conversia replică prețul din piață și nu inventează edge', () => {
  const dc = toDoubleChance({ pick: pick1x2(66), probs, odds1x2: odds, enabled: true });
  assert.equal(dc.market, 'double_chance');
  assert.equal(dc.selection, '1X');
  close(dc.model_prob_pct, 88);
  // 1/(1/1.8 + 1/3.6) = 1.2
  close(dc.book_odds, 1.2, 0.001);
  assert.equal(dc.edge_pct, null, 'cota e replicată din piață — nu există edge de preț');
  assert.equal(dc.kelly_stake, null, 'fără edge nu se calculează miză Kelly');
  assert.match(dc.warning, /nu e profitabil/);
  assert.equal(dc.converted_from.selection, '1');
});

test('conversia nu se aplică pieţelor care nu sunt 1X2', () => {
  const ou = { market: 'over_under', selection: 'Over 2.5', model_prob_pct: 70 };
  assert.equal(toDoubleChance({ pick: ou, probs, odds1x2: odds, enabled: true }), null);
  assert.equal(toDoubleChance({ pick: null, probs, odds1x2: odds, enabled: true }), null);
});

test('conversia are nevoie de cotele de piață', () => {
  assert.equal(toDoubleChance({ pick: pick1x2(66), probs, odds1x2: null, enabled: true }), null);
});

test('cota dublei e mereu sub cota simplă — nu e o afacere mai bună', () => {
  const dc = toDoubleChance({ pick: pick1x2(66), probs, odds1x2: odds, enabled: true });
  assert.ok(dc.book_odds < odds[0], `dubla ${dc.book_odds} trebuie sub simpla ${odds[0]}`);
  assert.ok(dc.model_prob_pct > 66, 'în schimb probabilitatea e mai mare');
});

test('runBot nu convertește când flagul e oprit (comportamentul implicit)', () => {
  const b = clone();
  b.market_odds = { '1x2': [2.10, 3.40, 3.60] };
  const r = runBot(b, { personalityId: 'ai-analyst', simulations: 800 });
  assert.notEqual(r.market, 'double_chance');
  assert.equal(r.warning, null);
});

test('avertismentul ajunge în reasoning, nu doar în JSON', async () => {
  const { buildReasoning } = await import('../src/bot/reasoning.js');
  const { getPersonality } = await import('../src/bot/personalities.js');
  const dc = toDoubleChance({ pick: pick1x2(66), probs, odds1x2: odds, enabled: true });
  const r = buildReasoning({
    analysis: { models_detail: {}, models_consensus: { available: false } },
    pick: dc, personality: getPersonality('ai-analyst'), context: null,
  });
  assert.ok(r.bullets.some((b) => b.includes('nu e profitabil')), 'avertismentul trebuie vizibil');
  assert.ok(r.bullets.some((b) => b.includes('replicată din piața 1X2')));
});

test('miza nu se schimbă prin conversie — fallback, nu strategie', () => {
  const dc = toDoubleChance({ pick: { ...pick1x2(66), kelly_stake: 0.04 }, probs, odds1x2: odds, enabled: true });
  assert.equal(dc.kelly_stake, null, 'nu se propagă o miză calculată pe alt pariu');
});

test('reducedStake limitează expunerea, fără să pretindă că îmbunătățește ceva', async () => {
  const { reducedStake, STAKE_REDUCTION } = await import('../src/bot/doubleChance.js');
  assert.equal(STAKE_REDUCTION, 0.5, 'implicit jumătate');
  assert.equal(reducedStake(0.04), 0.02);
  assert.equal(reducedStake(0.04, 0.25), 0.01);
  assert.equal(reducedStake(0.04, 5), 0.02, 'reducere absurdă ⇒ cade pe 0.5');
  assert.equal(reducedStake(0.04, -1), 0.02);
  assert.equal(reducedStake(0), null);
  assert.equal(reducedStake(null), null);
});

test('pick-ul convertit poartă miza redusă, nu pe cea originală', () => {
  const dc = toDoubleChance({
    pick: { ...pick1x2(66), kelly_stake: 0.04 }, probs, odds1x2: odds, enabled: true,
  });
  assert.equal(dc.kelly_stake, null, 'nu există Kelly fără edge');
  assert.equal(dc.suggested_stake_fraction, 0.02, 'jumătate din miza originală');
  assert.equal(dc.stake_reduction, 0.5);
});
