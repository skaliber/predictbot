import test from 'node:test';
import assert from 'node:assert/strict';
import { handicapMargin, settleHandicap, coverProbability } from '../src/lib/asianHandicap.js';
import { dixonColesMatrix } from '../src/models/dixonColes.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const settle = (h, a, line, side, odds = 2) => settleHandicap({ homeGoals: h, awayGoals: a, line, side, odds });

test('marja e simetrică între gazde și oaspeți', () => {
  const args = { homeGoals: 2, awayGoals: 1, line: -0.5 };
  close(handicapMargin({ ...args, side: 'home' }), 0.5);
  close(handicapMargin({ ...args, side: 'away' }), -0.5);
});

test('linie întreagă: egalitatea întoarce miza', () => {
  // DNB (linie 0), meci egal ⇒ push.
  const r = settle(1, 1, 0, 'home');
  assert.equal(r.outcome, 'push');
  close(r.return, 1);
  close(r.profit, 0);
});

test('linie întreagă: −1 cu victorie la un gol ⇒ push', () => {
  const r = settle(2, 1, -1, 'home');
  assert.equal(r.outcome, 'push');
  close(r.profit, 0);
});

test('linie de jumătate: nu există egalitate', () => {
  assert.equal(settle(1, 0, -0.5, 'home').outcome, 'win');
  assert.equal(settle(1, 1, -0.5, 'home').outcome, 'loss');
  close(settle(1, 0, -0.5, 'home', 1.9).profit, 0.9);
  close(settle(1, 1, -0.5, 'home', 1.9).profit, -1);
});

test('linie de sfert −0.25: egalul e jumătate pierdere', () => {
  // Jumătate la 0 (push), jumătate la −0.5 (pierdere) ⇒ returul e 0.5.
  const r = settle(0, 0, -0.25, 'home', 2.0);
  assert.equal(r.outcome, 'half_loss');
  close(r.return, 0.5);
  close(r.profit, -0.5);
});

test('linie de sfert +0.25: egalul e jumătate câștig', () => {
  // Jumătate la 0 (push, 0.5 înapoi), jumătate la +0.5 (câștig, 0.5 × cotă).
  const r = settle(0, 0, 0.25, 'home', 2.0);
  assert.equal(r.outcome, 'half_win');
  close(r.return, (2.0 + 1) / 2);
  close(r.profit, 0.5);
});

test('linie de sfert −0.75: victorie la un gol e jumătate câștig', () => {
  // Jumătate la −0.5 (câștig), jumătate la −1 (push).
  const r = settle(1, 0, -0.75, 'home', 2.1);
  assert.equal(r.outcome, 'half_win');
  close(r.return, (2.1 + 1) / 2);
});

test('linie de sfert −0.75: victorie la două goluri e câștig complet', () => {
  const r = settle(2, 0, -0.75, 'home', 2.1);
  assert.equal(r.outcome, 'win');
  close(r.return, 2.1);
});

test('partea oaspeților se decontează simetric', () => {
  const home = settle(1, 0, -0.5, 'home', 2);
  const away = settle(1, 0, -0.5, 'away', 2);
  assert.equal(home.outcome, 'win');
  assert.equal(away.outcome, 'loss');
  // Suma returnurilor pe o piață fără marjă ar fi 2 (o miză de fiecare parte).
  const push = settle(1, 1, 0, 'home', 2).return + settle(1, 1, 0, 'away', 2).return;
  close(push, 2);
});

test('aritmetica în virgulă mobilă nu transformă un push în pierdere', () => {
  // 0.1 + 0.2 ≠ 0.3 în binar; verificăm că toleranța prinde cazul.
  for (const line of [-2.75, -1.25, -0.75, -0.25, 0, 0.25, 1.75]) {
    for (let h = 0; h <= 4; h++) {
      for (let a = 0; a <= 4; a++) {
        const r = settle(h, a, line, 'home', 2);
        assert.ok(['win', 'half_win', 'push', 'half_loss', 'loss'].includes(r.outcome),
          `linie ${line}, scor ${h}-${a} ⇒ ${r.outcome}`);
        assert.ok(r.return >= 0 && r.return <= 2);
      }
    }
  }
});

test('settleHandicap respinge cote invalide', () => {
  assert.equal(settleHandicap({ homeGoals: 1, awayGoals: 0, line: 0, side: 'home', odds: 0.5 }), null);
});

test('coverProbability: la linia 0 e probabilitatea de victorie fără egal', () => {
  const m = dixonColesMatrix(1.6, 1.0, -0.03);
  const p = coverProbability({ matrix: m, line: 0, side: 'home' });
  // DNB: victorie gazde / (1 − egal). Trebuie peste probabilitatea brută.
  let home = 0, draw = 0;
  for (let h = 0; h < m.length; h++) for (let a = 0; a < m.length; a++) {
    if (h > a) home += m[h][a]; else if (h === a) draw += m[h][a];
  }
  close(p, home / (1 - draw), 1e-6);
});

test('coverProbability: gazde + oaspeți = 1 pe orice linie', () => {
  const m = dixonColesMatrix(1.8, 1.1, -0.03);
  for (const line of [-1.5, -1, -0.75, -0.5, -0.25, 0, 0.5, 1]) {
    const h = coverProbability({ matrix: m, line, side: 'home' });
    const a = coverProbability({ matrix: m, line, side: 'away' });
    close(h + a, 1, 1e-6);
  }
});

test('coverProbability scade pe măsură ce handicapul e mai dur', () => {
  const m = dixonColesMatrix(1.8, 1.0, -0.03);
  const p0 = coverProbability({ matrix: m, line: 0, side: 'home' });
  const p1 = coverProbability({ matrix: m, line: -1, side: 'home' });
  const p2 = coverProbability({ matrix: m, line: -2, side: 'home' });
  assert.ok(p0 > p1 && p1 > p2, `${p0} > ${p1} > ${p2}`);
});

test('coverProbability pe input invalid', () => {
  assert.equal(coverProbability({ matrix: null, line: 0, side: 'home' }), null);
});
