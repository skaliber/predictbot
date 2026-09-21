import test from 'node:test';
import assert from 'node:assert/strict';
import { closingProbs, clvPoints, logLoss, logLossBinary, bootstrapRoi, sliceSummary } from '../src/lib/clv.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('closingProbs de-vighează și normalizează la 1', () => {
  const p = closingProbs([1.51, 4.24, 7.59]);
  close(p.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
  assert.equal(closingProbs([0.5, 3, 3]), null);
  assert.equal(closingProbs(null), null);
});

test('clvPoints: linia care se mișcă spre tine dă CLV pozitiv', () => {
  // Ai pariat la un preț care implica 40%; piața a închis la 45.5% ⇒ +5.5pp.
  close(clvPoints({ openProb: 0.400, closingProb: 0.455 }), 5.5);
  // Linia s-a mișcat împotriva ta.
  close(clvPoints({ openProb: 0.500, closingProb: 0.450 }), -5);
  assert.equal(clvPoints({ openProb: NaN, closingProb: 0.5 }), null);
});

test('clvOddsPct: cotă mai bună decât închiderea = CLV pozitiv', async () => {
  const { clvOddsPct } = await import('../src/lib/clv.js');
  close(clvOddsPct({ openOdds: 2.5, closeOdds: 2.2 }), 13.64, 0.05);
  close(clvOddsPct({ openOdds: 2.0, closeOdds: 2.0 }), 0);
  assert.ok(clvOddsPct({ openOdds: 1.9, closeOdds: 2.2 }) < 0);
  assert.equal(clvOddsPct({ openOdds: 0.5, closeOdds: 2 }), null);
});

test('CLV nu trebuie confundat cu edge-ul de model', () => {
  // Regresie: dacă filtrezi pariurile după „model − închidere ≥ prag" și apoi
  // raportezi acea diferență drept CLV, e pozitivă prin construcție.
  // CLV-ul corect nu depinde deloc de model.
  const modelProb = 0.70, closingProb = 0.55, openProb = 0.56;
  const realClv = clvPoints({ openProb, closingProb });
  close(realClv, -1, 0.01);
  assert.ok(realClv < 0, 'modelul vede +15pp edge, dar linia s-a mișcat contra');
});

test('logLoss penalizează predicția greșită', () => {
  close(logLoss([1, 0, 0], '1'), 0, 1e-9);
  assert.ok(logLoss([0.5, 0.3, 0.2], '1') < logLoss([0.2, 0.3, 0.5], '1'));
  assert.ok(Number.isFinite(logLoss([0, 0, 1], '1')), 'probabilitate zero nu produce infinit');
  assert.equal(logLoss([0.5, 0.3, 0.2], 'Z'), null);
});

test('logLossBinary e simetric', () => {
  close(logLossBinary(0.7, true), logLossBinary(0.3, false));
  assert.ok(logLossBinary(0.9, true) < logLossBinary(0.6, true));
  assert.ok(Number.isFinite(logLossBinary(0, true)));
  assert.ok(Number.isFinite(logLossBinary(1, false)));
});

test('bootstrapRoi: intervalul conține media și e determinist', () => {
  const bets = Array.from({ length: 300 }, (_, i) => ({ hit: i % 2 === 0, odds: 2.2 }));
  const r1 = bootstrapRoi(bets);
  const r2 = bootstrapRoi(bets);
  assert.deepEqual(r1.ci95, r2.ci95, 'același seed ⇒ același rezultat');
  assert.ok(r1.ci95[0] < r1.roi_pct && r1.roi_pct < r1.ci95[1]);
  close(r1.roi_pct, 10, 0.5); // (2.2−1)/2 − 1/2 = +10%
});

test('bootstrapRoi: intervalul se îngustează cu eșantionul', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => ({ hit: i % 3 === 0, odds: 3 }));
  const w = (r) => r.ci95[1] - r.ci95[0];
  assert.ok(w(bootstrapRoi(make(2000))) < w(bootstrapRoi(make(100))));
  assert.equal(bootstrapRoi([]), null);
});

const bet = (hit, odds, clv, extra = {}) => ({ hit, odds, clv, ...extra });

test('sliceSummary promovează doar când toate trei criteriile trec', () => {
  // CLV pozitiv, ROI pozitiv, n suficient.
  const good = Array.from({ length: 250 }, (_, i) => bet(i % 2 === 0, 2.3, 2.5));
  const s = sliceSummary(good);
  assert.equal(s.verdict, 'PASS');
  assert.ok(s.roi_pct > 0);
  assert.ok(s.mean_clv_pp > 0);
  assert.deepEqual(s.fail_reasons, []);
});

test('sliceSummary respinge eșantionul mic, oricât de bun ar arăta', () => {
  const few = Array.from({ length: 50 }, () => bet(true, 3, 10));
  const s = sliceSummary(few);
  assert.equal(s.verdict, 'FAIL');
  assert.ok(s.fail_reasons.some((r) => r.includes('n=50')));
  assert.ok(s.roi_pct > 100, 'ROI-ul poate fi absurd de bun și tot FAIL');
});

test('sliceSummary respinge CLV negativ chiar cu ROI pozitiv', () => {
  // Noroc: ROI bun, dar modelul vedea sistematic mai prost decât închiderea.
  const lucky = Array.from({ length: 300 }, (_, i) => bet(i % 2 === 0, 2.4, -3));
  const s = sliceSummary(lucky);
  assert.equal(s.verdict, 'FAIL');
  assert.ok(s.roi_pct > 0, 'ROI-ul e pozitiv');
  assert.deepEqual(s.fail_reasons, ['CLV ≤ 0']);
});

test('sliceSummary respinge ROI negativ chiar cu CLV pozitiv', () => {
  const s = sliceSummary(Array.from({ length: 300 }, (_, i) => bet(i % 5 === 0, 2.0, 4)));
  assert.equal(s.verdict, 'FAIL');
  assert.ok(s.fail_reasons.includes('ROI ≤ 0'));
});

test('sliceSummary raportează log-loss model vs piață', () => {
  const bets = Array.from({ length: 250 }, (_, i) =>
    bet(i % 2 === 0, 2.2, 1, { logLossModel: 0.9, logLossMarket: 1.0 }));
  const s = sliceSummary(bets);
  close(s.logloss_model, 0.9);
  close(s.logloss_market, 1.0);
  assert.ok(s.logloss_model < s.logloss_market, 'modelul e mai bun aici');
});

test('sliceSummary pe set gol', () => {
  assert.equal(sliceSummary([]), null);
});
