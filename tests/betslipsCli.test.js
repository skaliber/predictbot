import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('sieveMarkdown citește câmpurile aplatizate din raport, nu de sub .sieve', async () => {
  // Regresie: raportul pune sita ca { slug, match, pick, prob, ... }, iar
  // funcția de afișare căuta c.sieve.pick — /bets --markdown crăpa la rulare.
  const src = await readFile(new URL('../scripts/betslips.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function sieveMarkdown'), src.indexOf('function markdown('));
  assert.ok(!/c\.sieve\./.test(fn), 'sieveMarkdown nu trebuie să acceseze c.sieve.* — câmpurile sunt aplatizate');
  assert.ok(!/leaveReason/.test(fn), 'în raport, motivul de „lasă" e în câmpul `reason`');
  // Și forma raportului chiar e aplatizată.
  assert.match(src, /play: sieve\.play\.map\(\(c\) => \(\{ slug: c\.slug, match: c\.match, \.\.\.c\.sieve/);
  assert.match(src, /leave: sieve\.leave\.map\(\(c\) => \(\{ slug: c\.slug, match: c\.match, reason: c\.leaveReason/);
});
