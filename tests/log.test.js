import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('log-urile merg pe stderr, ca stdout să rămână parsabil', () => {
  const script = `
    import log from './src/lib/log.js';
    log.info('a'); log.warn('b'); log.error('c'); log.debug('d');
    process.stdout.write(JSON.stringify({ ok: true }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.deepEqual(JSON.parse(out), { ok: true }, 'stdout conține doar rezultatul');
});
