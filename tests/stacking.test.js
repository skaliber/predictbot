import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeLogit, buildMetaFeatures, fitScaler, applyScaler,
  trainMultinomial, predictMultinomial, trainStack,
} from '../src/models/stacking.js';

const close = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('safeLogit nu produce infinit la extreme', () => {
  assert.ok(Number.isFinite(safeLogit(0)));
  assert.ok(Number.isFinite(safeLogit(1)));
  close(safeLogit(0.5), 0, 1e-9);
  assert.ok(safeLogit(0.9) > 0 && safeLogit(0.1) < 0);
});

test('buildMetaFeatures păstrează alinierea când o sursă lipsește', () => {
  const rows = [
    { sources: { a: [0.5, 0.3, 0.2], b: [0.4, 0.4, 0.2] } },
    { sources: { a: [0.6, 0.2, 0.2] } }, // b lipsește
  ];
  const X = buildMetaFeatures(rows, ['a', 'b']);
  assert.equal(X[0].length, 6);
  assert.equal(X[1].length, 6, 'aceeași lățime, altfel modelul se strică');
  // Sursa lipsă devine logit neutru.
  close(X[1][3], safeLogit(1 / 3), 1e-9);
});

test('buildMetaFeatures adaugă feature-urile scalare', () => {
  const X = buildMetaFeatures(
    [{ sources: { a: [0.5, 0.3, 0.2] }, extra: { elo_diff: 120 } }],
    ['a'], ['elo_diff']
  );
  assert.equal(X[0].length, 4);
  assert.equal(X[0][3], 120);
});

test('buildMetaFeatures tratează extra lipsă ca zero', () => {
  const X = buildMetaFeatures([{ sources: { a: [0.5, 0.3, 0.2] } }], ['a'], ['elo_diff']);
  assert.equal(X[0][3], 0);
});

test('scaler standardizează la medie 0 și abatere 1', () => {
  const X = [[1, 10], [2, 20], [3, 30], [4, 40]];
  const s = fitScaler(X);
  const Z = applyScaler(X, s);
  const mean = Z.reduce((a, r) => a + r[0], 0) / Z.length;
  close(mean, 0, 1e-9);
  const varr = Z.reduce((a, r) => a + r[0] ** 2, 0) / Z.length;
  close(varr, 1, 1e-9);
});

test('scaler nu împarte la zero pe coloană constantă', () => {
  const s = fitScaler([[5], [5], [5]]);
  const Z = applyScaler([[5]], s);
  assert.ok(Number.isFinite(Z[0][0]));
});

test('regresia învață o regulă separabilă', () => {
  // Clasa se decide de primul feature: negativ → 0, aproape zero → 1, pozitiv → 2.
  const X = [], y = [];
  for (let i = 0; i < 300; i++) {
    const v = (i % 3) - 1; // -1, 0, 1
    X.push([v + (Math.random() - 0.5) * 0.1, Math.random()]);
    y.push(i % 3);
  }
  const s = fitScaler(X);
  const m = trainMultinomial(applyScaler(X, s), y, { iterations: 400, l2: 0.1 });
  const pred = (v) => {
    const [x] = applyScaler([[v, 0.5]], s);
    const p = predictMultinomial(m, x);
    return p.indexOf(Math.max(...p));
  };
  assert.equal(pred(-1), 0);
  assert.equal(pred(1), 2);
});

test('predicțiile însumează 1', () => {
  const X = [[1, 2], [2, 1], [3, 3], [0, 0]];
  const y = [0, 1, 2, 1];
  const m = trainMultinomial(X, y, { iterations: 50 });
  const p = predictMultinomial(m, [1.5, 1.5]);
  close(p.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(p.every((x) => x >= 0 && x <= 1));
});

test('L2 mai mare produce predicții mai apropiate de uniform', () => {
  const X = [], y = [];
  for (let i = 0; i < 200; i++) { X.push([(i % 2) * 4 - 2, 0]); y.push(i % 2 === 0 ? 0 : 2); }
  const weak = trainMultinomial(X, y, { iterations: 300, l2: 0.01 });
  const strong = trainMultinomial(X, y, { iterations: 300, l2: 500 });
  const spread = (m) => { const p = predictMultinomial(m, [2, 0]); return Math.max(...p) - Math.min(...p); };
  assert.ok(spread(strong) < spread(weak), 'regularizare puternică ⇒ predicții mai modeste');
});

test('trainMultinomial refuză set gol', () => {
  assert.throws(() => trainMultinomial([], []), /gol/);
});

test('trainStack învață să prefere sursa bună când una e zgomot', () => {
  // Sursa „bună" prezice corect; sursa „proasta" e aleatoare.
  let seed = 3;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const rows = [], labels = [];
  for (let i = 0; i < 600; i++) {
    const cls = i % 3;
    const good = [0.1, 0.1, 0.1];
    good[cls] = 0.8;
    const noise = [rand(), rand(), rand()];
    const s = noise.reduce((a, b) => a + b, 0);
    rows.push({ sources: { bun: good, zgomot: noise.map((v) => v / s) } });
    labels.push(cls);
  }
  const stack = trainStack(rows, labels, {
    sourceNames: ['bun', 'zgomot'], iterations: 300, l2: 0.5,
  });
  // Pe un caz nou unde sursa bună arată clasa 2, stackingul trebuie s-o urmeze.
  const p = stack.predict({ sources: { bun: [0.1, 0.1, 0.8], zgomot: [0.5, 0.3, 0.2] } });
  assert.equal(p.indexOf(Math.max(...p)), 2, `a ales ${JSON.stringify(p)}`);
});

test('trainStack e reproductibil pe aceleași date', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ sources: { a: [0.5, 0.3, 0.2] } }));
  const labels = rows.map((_, i) => i % 3);
  const opts = { sourceNames: ['a'], iterations: 50 };
  const p1 = trainStack(rows, labels, opts).predict(rows[0]);
  const p2 = trainStack(rows, labels, opts).predict(rows[0]);
  assert.deepEqual(p1, p2);
});
