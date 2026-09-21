import test from 'node:test';
import assert from 'node:assert/strict';
import { flatRoi, margin, bucketRoi, bucketize } from '../src/lib/hypothesis.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('flatRoi: pariu la cotă corectă dă ROI zero', () => {
  // Cotă 2.0, jumătate câștigă ⇒ profit mediu 0.
  const bets = [{ hit: true, odds: 2 }, { hit: false, odds: 2 }];
  const r = flatRoi(bets);
  close(r.roi_pct, 0);
  close(r.hit_rate_pct, 50);
  close(r.mean_odds, 2);
  assert.equal(r.n, 2);
});

test('flatRoi calculează profitul corect la cote diferite', () => {
  // +2, +2, −1, −1 = +2 pe 4 pariuri ⇒ +50%
  const bets = [
    { hit: true, odds: 3 }, { hit: true, odds: 3 },
    { hit: false, odds: 3 }, { hit: false, odds: 3 },
  ];
  close(flatRoi(bets).roi_pct, 50);
});

test('flatRoi: eroarea standard scade cu eșantionul', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => ({ hit: i % 2 === 0, odds: 2 }));
  assert.ok(flatRoi(make(1000)).se_pct < flatRoi(make(50)).se_pct);
});

test('flatRoi: t mare doar când rezultatul e consistent și pe eșantion mare', () => {
  // Strategie clar profitabilă, eșantion mare.
  const good = Array.from({ length: 500 }, (_, i) => ({ hit: i % 2 === 0, odds: 2.4 }));
  const r = flatRoi(good);
  assert.ok(r.roi_pct > 15);
  assert.ok(r.t > 2, `t=${r.t} ar trebui să fie peste 2`);

  // Același ROI, dar pe 6 pariuri ⇒ t mic, nu se poate afirma nimic.
  const few = Array.from({ length: 6 }, (_, i) => ({ hit: i % 2 === 0, odds: 2.4 }));
  assert.ok(flatRoi(few).t < 2, 'la n mic nu se poate concluziona');
});

test('flatRoi pe set gol e null', () => {
  assert.equal(flatRoi([]), null);
});

test('margin măsoară marja bookmakerului', () => {
  close(margin([2, 2]), 0, 1e-9);
  close(margin([1.9, 1.9]), 0.0526, 0.001);
  assert.ok(margin([1.5, 4.5, 6.5]) > 0);
});

test('bucketize încadrează corect, inclusiv la margini', () => {
  const edges = [1, 2, 3, 100];
  const labels = ['mic', 'mediu', 'mare'];
  assert.equal(bucketize(1, edges, labels), 'mic');
  assert.equal(bucketize(1.99, edges, labels), 'mic');
  assert.equal(bucketize(2, edges, labels), 'mediu');
  assert.equal(bucketize(50, edges, labels), 'mare');
  assert.equal(bucketize(0.5, edges, labels), null, 'sub interval');
  assert.equal(bucketize(200, edges, labels), null, 'peste interval');
});

test('bucketRoi grupează și păstrează ordinea cerută', () => {
  const bets = [
    { hit: true, odds: 1.5, g: 'favorit' }, { hit: true, odds: 1.5, g: 'favorit' },
    { hit: false, odds: 8, g: 'outsider' }, { hit: false, odds: 8, g: 'outsider' },
  ];
  const r = bucketRoi(bets, (b) => b.g, ['favorit', 'outsider']);
  assert.deepEqual(r.map((x) => x.bucket), ['favorit', 'outsider']);
  close(r[0].roi_pct, 50);
  close(r[1].roi_pct, -100);
});

test('bucketRoi ignoră cheile nule', () => {
  const bets = [{ hit: true, odds: 2, g: null }, { hit: true, odds: 2, g: 'x' }];
  const r = bucketRoi(bets, (b) => b.g);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 1);
});
