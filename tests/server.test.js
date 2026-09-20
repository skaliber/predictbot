import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

test('GET /health raportează boții disponibili', async () => {
  const { server, url } = await listen(createApp());
  try {
    const res = await fetch(`${url}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(body.bots.includes('ai-analyst'));
  } finally { server.close(); }
});

test('GET /api/bots listează personalitățile cu politicile lor', async () => {
  const { server, url } = await listen(createApp());
  try {
    const body = await (await fetch(`${url}/api/bots`)).json();
    assert.ok(body.bots.length >= 7);
    const analyst = body.bots.find((b) => b.id === 'ai-analyst');
    assert.ok(analyst.policy.markets.includes('1x2'));
    assert.ok(analyst.weights.dixonColes > 0);
  } finally { server.close(); }
});

test('POST /predict respinge botul necunoscut și slug-ul lipsă', async () => {
  const { server, url } = await listen(createApp());
  try {
    const bad = await fetch(`${url}/api/bots/inexistent/predict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchSlug: 'x' }),
    });
    assert.equal(bad.status, 404);
    assert.equal((await bad.json()).code, 'UNKNOWN_BOT');

    const noSlug = await fetch(`${url}/api/bots/ai-analyst/predict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(noSlug.status, 400);
    assert.equal((await noSlug.json()).code, 'MISSING_SLUG');
  } finally { server.close(); }
});

test('rută necunoscută întoarce 404 JSON', async () => {
  const { server, url } = await listen(createApp());
  try {
    const res = await fetch(`${url}/nimic`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'NOT_FOUND');
  } finally { server.close(); }
});

test('createApp nu pornește singur un listener (entrypoint-ul e src/bin/serve.js)', async () => {
  // Regresie: garda import.meta.url nu se potrivea sub PM2, iar procesul pornea
  // fără să asculte pe niciun port. Acum pornirea e explicită, în serve.js.
  const app = createApp();
  assert.equal(typeof app.listen, 'function');
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8'));
  assert.ok(!src.includes('process.argv[1]'), 'server.js nu trebuie să conțină gardă pe argv');
  assert.ok(!/app\.listen\(/.test(src), 'server.js nu trebuie să apeleze listen');
});
