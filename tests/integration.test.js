import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RateLimiter, sleep } from '../src/lib/rateLimiter.js';
import { mlSource, trendMarkets, runBot } from '../src/bot/botLogic.js';

const bundle = JSON.parse(readFileSync(new URL('./fixtures/match-bundle.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(bundle));

test('RateLimiter blochează peste prag și eliberează după fereastră', async () => {
  const rl = new RateLimiter({ maxRequests: 3, windowMs: 120 });
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await rl.acquire();
  assert.ok(Date.now() - t0 < 50, 'primele 3 trec imediat');
  assert.equal(rl.pending, 3);
  await rl.acquire();                       // a 4-a așteaptă fereastra
  assert.ok(Date.now() - t0 >= 100, `a așteptat ${Date.now() - t0}ms`);
});

test('RateLimiter.blockFor oprește emiterea până la deblocare', async () => {
  const rl = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
  rl.blockFor(120);
  const t0 = Date.now();
  await rl.acquire();
  assert.ok(Date.now() - t0 >= 100, `a așteptat ${Date.now() - t0}ms`);
});

test('sleep chiar așteaptă', async () => {
  const t0 = Date.now();
  await sleep(60);
  assert.ok(Date.now() - t0 >= 55);
});

test('request reîncearcă pe 429 respectând ratelimit-reset', async () => {
  const { limiter } = await import('../src/dataFetcher.js');
  limiter.blockedUntil = 0;
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'Limită depășită', code: 'RATE_LIMITED' }), {
        status: 429, headers: { 'ratelimit-reset': '0' },
      });
    }
    return new Response(JSON.stringify({ matches: [] }), { status: 200 });
  };
  try {
    const { listMatchesPage } = await import('../src/dataFetcher.js');
    const r = await listMatchesPage({ limit: 5 });
    assert.equal(calls, 2, 'a reîncercat o dată după 429');
    assert.deepEqual(r.matches, []);
  } finally { globalThis.fetch = realFetch; limiter.blockedUntil = 0; }
});

test('fetchMatchBundle cere models + sursele opționale, și nu cade pe cele lipsă', async () => {
  const { fetchMatchBundle, limiter } = await import('../src/dataFetcher.js');
  limiter.blockedUntil = 0;
  const paths = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    paths.push(p);
    if (p.endsWith('/ml-1x2')) {
      return new Response(JSON.stringify({ error: 'Resursă negăsită', code: 'NOT_FOUND' }), { status: 404 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const b = await fetchMatchBundle('a-vs-b');
    assert.ok(paths.some((p) => p.endsWith('/models')));
    assert.ok(paths.some((p) => p.endsWith('/corner-card-trends')));
    assert.deepEqual(b.ml_1x2, null, 'sursa lipsă devine null');
    assert.equal(b.partial.length, 1);
    assert.equal(b.partial[0].source, 'ml_1x2');
    assert.equal(b.partial[0].code, 'NOT_FOUND');
    assert.ok(b.fetched_at);
  } finally { globalThis.fetch = realFetch; }
});

test('fetchMatchBundle aruncă doar dacă /models lipsește', async () => {
  const { fetchMatchBundle, limiter } = await import('../src/dataFetcher.js');
  limiter.blockedUntil = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.endsWith('/models')) {
      return new Response(JSON.stringify({ error: 'Not available', code: 'MODELS_NOT_AVAILABLE' }), { status: 422 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await assert.rejects(() => fetchMatchBundle('a-vs-b'), /models indisponibile/);
  } finally { globalThis.fetch = realFetch; }
});

test('predictMatchForBots face UN SINGUR fetch pentru toate personalitățile', async () => {
  const { limiter } = await import('../src/dataFetcher.js');
  limiter.blockedUntil = 0;
  const models = bundle.models;
  let modelCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/models')) { modelCalls++; return new Response(JSON.stringify(models), { status: 200 }); }
    if (p.endsWith('/context')) return new Response(JSON.stringify(bundle.context), { status: 200 });
    return new Response(JSON.stringify({ eligible: false }), { status: 200 });
  };
  try {
    const { predictMatchForBots } = await import('../src/index.js');
    const bots = ['ai-analyst', 'statisticianul', 'matematicianul', 'istoricul'];
    const out = await predictMatchForBots('a-vs-b', { personalityIds: bots, simulations: 500 });
    assert.equal(out.length, 4);
    assert.equal(modelCalls, 1, `un singur fetch de models, au fost ${modelCalls}`);
    assert.ok(out.every((r) => !r.error), JSON.stringify(out.filter((r) => r.error)));
  } finally { globalThis.fetch = realFetch; }
});

test('mlSource convertă procentele în fracții, sau întoarce null', () => {
  const r = mlSource({ prediction: { home_win_prob: 55, draw_prob: 25, away_win_prob: 20, top_pick: '1' } });
  assert.ok(Math.abs(r.source.home_win - 0.55) < 1e-9);
  assert.ok(Math.abs(r.source.home_win + r.source.draw + r.source.away_win - 1) < 1e-9);
  assert.equal(r.detail.top_pick, '1');
  assert.equal(mlSource(null), null);
  assert.equal(mlSource({ prediction: { home_win_prob: 55 } }), null);
});

test('mlSource intră în ensemble și schimbă probabilitățile', () => {
  const withoutMl = runBot(clone(), { personalityId: 'ai-analyst', simulations: 800 });
  const b = clone();
  b.ml_1x2 = { prediction: { home_win_prob: 20, draw_prob: 30, away_win_prob: 50 } };
  const withMl = runBot(b, { personalityId: 'ai-analyst', simulations: 800 });
  assert.ok(withMl.models_used.includes('ml'));
  assert.ok(withMl.probabilities.home_win_pct < withoutMl.probabilities.home_win_pct,
    'ML-ul pro-oaspeți trebuie să scadă probabilitatea gazdelor');
  assert.ok(withMl.reasoning.bullets.some((x) => x.includes('ML calibrat')));
});

test('trendMarkets combină liniile pe total meci', () => {
  const t = trendMarkets({
    eligible: true,
    home_team: { corners: { avg: 5.3, line: 5.5, sample_size: 3 }, cards: { avg: 1.3, line: 1.5, sample_size: 3 } },
    away_team: { corners: { avg: 4, line: 4.5, sample_size: 4 }, cards: { avg: 2.3, line: 2.5, sample_size: 4 } },
    league_coverage: { coverage_pct: 52.1 },
  });
  assert.equal(t.corners.line, 10);
  assert.ok(Math.abs(t.corners.avg - 9.3) < 1e-9);
  assert.equal(t.corners.side, 'under');
  assert.equal(t.cards.line, 4);
  assert.ok(Math.abs(t.cards.avg - 3.6) < 1e-9);
  assert.equal(t.cards.side, 'under');
  assert.equal(t.corners.sample_size, 3, 'eșantionul e minimul dintre echipe');
});

test('trendMarkets întoarce null pentru ligi neeligibile', () => {
  assert.equal(trendMarkets({ eligible: false }), null);
  assert.equal(trendMarkets(null), null);
  assert.equal(trendMarkets({ eligible: true, home_team: {}, away_team: {} }), null);
});

test('trendMarkets ajunge în reasoning', () => {
  const b = clone();
  b.corner_card_trends = {
    eligible: true,
    home_team: { corners: { avg: 6.5, line: 5.5, sample_size: 5 }, cards: { avg: 2.1, line: 1.5, sample_size: 5 } },
    away_team: { corners: { avg: 5.2, line: 4.5, sample_size: 5 }, cards: { avg: 2.4, line: 2.5, sample_size: 5 } },
    league_coverage: { coverage_pct: 60 },
  };
  const r = runBot(b, { personalityId: 'ai-analyst', simulations: 500 });
  assert.equal(r.trends.corners.side, 'over');
  assert.ok(r.reasoning.bullets.some((x) => x.includes('Tendințe istorice')));
});
