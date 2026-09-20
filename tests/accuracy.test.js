import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionHit, summarize } from '../src/lib/accuracy.js';

test('selectionHit acoperă toate piețele', () => {
  assert.equal(selectionHit('1', 2, 1), true);
  assert.equal(selectionHit('1', 1, 1), false);
  assert.equal(selectionHit('X', 1, 1), true);
  assert.equal(selectionHit('2', 0, 3), true);
  assert.equal(selectionHit('Over 2.5', 2, 1), true);
  assert.equal(selectionHit('Over 2.5', 1, 1), false);
  assert.equal(selectionHit('Under 2.5', 1, 1), true);
  assert.equal(selectionHit('BTTS Yes', 1, 1), true);
  assert.equal(selectionHit('BTTS Yes', 3, 0), false);
  assert.equal(selectionHit('BTTS No', 3, 0), true);
  assert.equal(selectionHit('Asian Handicap', 1, 0), null);
});

test('summarize calculează acuratețe, ROI Kelly și ROI flat', () => {
  const preds = [
    { selection: '1', market: '1x2', kelly_stake: 0.04, candidates: [{ selection: '1', book_odds: 2.0 }], result: { score_home: 2, score_away: 0 } },
    { selection: '1', market: '1x2', kelly_stake: 0.04, candidates: [{ selection: '1', book_odds: 2.0 }], result: { score_home: 0, score_away: 1 } },
    { selection: 'Over 2.5', market: 'over_under', kelly_stake: 0.02, candidates: [{ selection: 'Over 2.5', book_odds: 1.8 }], result: { score_home: 2, score_away: 2 } },
    { selection: null }, // NO BET
    { selection: '2', market: '1x2', kelly_stake: 0.03, candidates: [{ selection: '2', book_odds: 3.0 }] }, // nesoluționat
  ];
  const s = summarize(preds);
  assert.equal(s.predictions, 5);
  assert.equal(s.bets, 4);
  assert.equal(s.no_bets, 1);
  assert.equal(s.settled, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.accuracy_pct, 66.7);
  // Kelly: +0.04 (cota 2.0) − 0.04 + 0.02*0.8 = 0.016 profit pe 0.10 mizat = 16%
  assert.equal(s.kelly_roi_pct, 16);
  // Flat 1u: +1 − 1 + 0.8 = 0.8 pe 3 pariuri ≈ 26.7%
  assert.equal(s.flat_roi_pct, 26.7);
  assert.equal(s.by_market['1x2'].accuracy_pct, 50);
  assert.equal(s.by_market.over_under.accuracy_pct, 100);
});

test('summarize pe set gol nu împarte la zero', () => {
  const s = summarize([]);
  assert.equal(s.settled, 0);
  assert.equal(s.accuracy_pct, null);
  assert.equal(s.kelly_roi_pct, null);
  assert.equal(s.flat_roi_pct, null);
});

// ---- dataFetcher: formatarea datelor pentru API ----
import { toApiDate } from '../src/dataFetcher.js';

test('toApiDate produce YYYY-MM-DD (API-ul respinge ISO 8601 complet)', () => {
  assert.equal(toApiDate('2026-10-10T14:00:00.000Z'), '2026-10-10');
  assert.equal(toApiDate(new Date(Date.UTC(2026, 9, 10, 23, 59))), '2026-10-10');
  assert.equal(toApiDate(Date.UTC(2026, 0, 1)), '2026-01-01');
  assert.throws(() => toApiDate('nu e o dată'), /dată invalidă/);
});

test('endpoint-urile PredictCamp folosesc căile din OpenAPI', async () => {
  // Regresie: /bot-predictions nu există în spec (întorcea 500), calea e /bots.
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(new URL(url).pathname);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { getBotPredictions, getMatchModels, getMatchContext, getMl1x2 } = await import('../src/dataFetcher.js');
    await getBotPredictions('a-vs-b');
    await getMatchModels('a-vs-b');
    await getMatchContext('a-vs-b');
    await getMl1x2('a-vs-b');
  } finally { globalThis.fetch = realFetch; }
  assert.ok(calls[0].endsWith('/matches/a-vs-b/bots'), calls[0]);
  assert.ok(!calls.some((c) => c.includes('bot-predictions')), 'nicio cale /bot-predictions');
  assert.ok(calls[1].endsWith('/matches/a-vs-b/models'));
  assert.ok(calls[2].endsWith('/matches/a-vs-b/context'));
  assert.ok(calls[3].endsWith('/matches/a-vs-b/ml-1x2'));
});
