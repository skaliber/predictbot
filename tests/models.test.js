import test from 'node:test';
import assert from 'node:assert/strict';
import { poissonPmf, scoreMatrix, marketsFromMatrix, predictPoisson } from '../src/models/poisson.js';
import { tau, timeDecayWeight, dixonColesMatrix, fitDixonColes, lambdasFromFit, predictDixonColes } from '../src/models/dixonColes.js';
import { eloProbabilities, updateElo, buildRatings } from '../src/models/elo.js';
import { simulate, makeRng, upsetProbability } from '../src/models/monteCarlo.js';
import { blend, agreement } from '../src/models/ensemble.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('poissonPmf respectă valorile analitice', () => {
  close(poissonPmf(0, 1), Math.exp(-1));
  close(poissonPmf(1, 1), Math.exp(-1));
  close(poissonPmf(2, 2), 2 * Math.exp(-2));
  assert.equal(poissonPmf(-1, 1), 0);
});

test('matricea Poisson însumează 1', () => {
  const m = scoreMatrix(1.8, 0.9, 10);
  const total = m.flat().reduce((s, p) => s + p, 0);
  close(total, 1, 1e-9);
});

test('piețele derivate din matrice sunt consistente', () => {
  const r = predictPoisson({ lambdaHome: 1.5, lambdaAway: 1.2 });
  close(r.home_win + r.draw + r.away_win, 1, 1e-9);
  close(r.over25 + r.under25, 1, 1e-9);
  close(r.btts_yes + r.btts_no, 1, 1e-9);
  assert.ok(r.over25 < r.over15, 'Over 2.5 trebuie sub Over 1.5');
  assert.ok(r.expected_goals > 2.5 && r.expected_goals < 2.8);
});

test('lambda mai mare pentru gazde ⇒ probabilitate mai mare pentru gazde', () => {
  const r = predictPoisson({ lambdaHome: 2.2, lambdaAway: 0.8 });
  assert.ok(r.home_win > r.away_win);
});

test('tau Dixon-Coles corectează doar scorurile mici', () => {
  close(tau(0, 0, 1.5, 1.0, -0.05), 1 - 1.5 * 1.0 * -0.05);
  close(tau(0, 1, 1.5, 1.0, -0.05), 1 + 1.5 * -0.05);
  close(tau(1, 0, 1.5, 1.0, -0.05), 1 + 1.0 * -0.05);
  close(tau(1, 1, 1.5, 1.0, -0.05), 1 + 0.05);
  assert.equal(tau(2, 3, 1.5, 1.0, -0.05), 1);
});

test('rho negativ crește probabilitatea de 0-0 față de Poisson pur', () => {
  const dc = dixonColesMatrix(1.4, 1.1, -0.08);
  const po = scoreMatrix(1.4, 1.1);
  assert.ok(dc[0][0] > po[0][0]);
  close(dc.flat().reduce((s, p) => s + p, 0), 1, 1e-9);
});

test('time decay scade monoton și e 1 la zi zero', () => {
  const ref = '2026-09-20';
  close(timeDecayWeight('2026-09-20', ref), 1);
  const w30 = timeDecayWeight('2026-08-21', ref);
  const w300 = timeDecayWeight('2025-11-24', ref);
  assert.ok(w30 > w300 && w300 > 0 && w30 < 1);
});

test('fitDixonColes recuperează parametrii din date generate cu lambda cunoscute', () => {
  // Date sintetice: goluri simulate din λ = exp(atac_h + apărare_a + γ).
  const day = (i) => new Date(2026, 0, 1 + i).toISOString().slice(0, 10);
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const samplePoisson = (l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };

  const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const atk = { A: 0.45, B: 0.1, C: -0.15, D: -0.4, E: 0.2, F: -0.2 };
  const def = { A: -0.35, B: -0.05, C: 0.15, D: 0.25, E: -0.1, F: 0.1 };
  const matches = [];
  let i = 0;
  for (let r = 0; r < 8; r++) {
    for (const h of teams) for (const a of teams) {
      if (h === a) continue;
      matches.push({
        home: h, away: a,
        homeGoals: samplePoisson(Math.exp(atk[h] + def[a] + 0.25)),
        awayGoals: samplePoisson(Math.exp(atk[a] + def[h])),
        date: day(i++ % 700),
      });
    }
  }

  const fit = fitDixonColes(matches, { referenceDate: '2028-01-01', xi: 0 });
  assert.equal(fit.sampleSize, matches.length);

  // Atacul cel mai bun / cel mai slab trebuie identificate corect.
  const byAttack = Object.entries(fit.attack).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  assert.equal(byAttack[0], 'A');
  assert.ok(fit.attack.A > fit.attack.D, 'A atacă mai bine ca D');
  // Apărarea mai mică = mai bună (δ apare multiplicativ în golurile primite).
  assert.ok(fit.defence.A < fit.defence.D, 'A apără mai bine ca D');

  // λ estimat trebuie să fie aproape de cel real (±20%).
  const { lambdaHome, lambdaAway } = lambdasFromFit(fit, 'A', 'D');
  const trueHome = Math.exp(atk.A + def.D + 0.25);
  const trueAway = Math.exp(atk.D + def.A);
  assert.ok(Math.abs(lambdaHome - trueHome) / trueHome < 0.2, `λ_home ${lambdaHome} vs ${trueHome}`);
  assert.ok(Math.abs(lambdaAway - trueAway) / trueAway < 0.35, `λ_away ${lambdaAway} vs ${trueAway}`);

  const pred = predictDixonColes({ fit, home: 'A', away: 'D' });
  assert.ok(pred.home_win > pred.away_win);
  assert.ok(Math.abs(pred.home_win + pred.draw + pred.away_win - 1) < 1e-9);
});

test('fitDixonColes: time decay schimbă estimarea spre forma recentă', () => {
  const matches = [];
  // Prima jumătate de sezon: A pierde. A doua: A domină.
  for (let i = 0; i < 15; i++) {
    matches.push({ home: 'A', away: 'B', homeGoals: 0, awayGoals: 2, date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` });
  }
  for (let i = 0; i < 15; i++) {
    matches.push({ home: 'A', away: 'B', homeGoals: 3, awayGoals: 0, date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}` });
  }
  const noDecay = fitDixonColes(matches, { referenceDate: '2026-10-01', xi: 0 });
  const withDecay = fitDixonColes(matches, { referenceDate: '2026-10-01', xi: 0.02 });
  const lNo = lambdasFromFit(noDecay, 'A', 'B').lambdaHome;
  const lDecay = lambdasFromFit(withDecay, 'A', 'B').lambdaHome;
  assert.ok(lDecay > lNo, `decay ${lDecay} trebuie > fără decay ${lNo}`);
  assert.ok(withDecay.effectiveSampleSize < noDecay.effectiveSampleSize);
});

test('fitDixonColes estimează rho în intervalul admis', () => {
  const matches = [];
  for (let i = 0; i < 40; i++) {
    matches.push({ home: 'A', away: 'B', homeGoals: i % 3, awayGoals: (i + 1) % 3, date: `2026-0${(i % 9) + 1}-10` });
  }
  const fit = fitDixonColes(matches, { referenceDate: '2026-10-01' });
  assert.ok(fit.rho >= -0.2 && fit.rho <= 0.2);
});

test('fitDixonColes respinge input insuficient', () => {
  assert.throws(() => fitDixonColes([{ home: 'a', away: 'b', homeGoals: 1, awayGoals: 0 }]), /prea puține/);
});

test('Elo: probabilitățile însumează 1 și favorizează ratingul mai mare', () => {
  const p = eloProbabilities(1700, 1400);
  close(p.home_win + p.draw + p.away_win, 1, 1e-9);
  assert.ok(p.home_win > p.away_win);
  const even = eloProbabilities(1500, 1500);
  assert.ok(even.draw > p.draw, 'egalul e mai probabil între echipe egale');
});

test('updateElo e cu sumă zero și scalează cu marja', () => {
  const a = updateElo(1500, 1500, 1, 0);
  close(a.home - 1500, 1500 - a.away);
  const big = updateElo(1500, 1500, 5, 0);
  assert.ok(big.delta > a.delta, 'marjă mai mare ⇒ ajustare mai mare');
});

test('buildRatings procesează cronologic', () => {
  const r = buildRatings([
    { home: 'A', away: 'B', homeGoals: 2, awayGoals: 0, date: '2026-01-01' },
    { home: 'B', away: 'A', homeGoals: 0, awayGoals: 1, date: '2026-02-01' },
  ]);
  assert.ok(r.A > 1500 && r.B < 1500);
});

test('Monte Carlo converge către matricea sursă', () => {
  const m = dixonColesMatrix(1.7, 1.0, -0.03);
  const analytic = marketsFromMatrix(m);
  const sim = simulate(m, { simulations: 40000, seed: 7 });
  assert.ok(Math.abs(sim.home_win - analytic.home_win) < 0.02, `MC ${sim.home_win} vs analitic ${analytic.home_win}`);
  assert.ok(Math.abs(sim.over25 - analytic.over25) < 0.02);
  close(sim.home_win + sim.draw + sim.away_win, 1, 1e-9);
});

test('Monte Carlo e determinist cu același seed', () => {
  const m = dixonColesMatrix(1.5, 1.2);
  assert.equal(simulate(m, { simulations: 2000, seed: 11 }).home_win, simulate(m, { simulations: 2000, seed: 11 }).home_win);
  assert.notEqual(simulate(m, { simulations: 2000, seed: 11 }).home_win, simulate(m, { simulations: 2000, seed: 12 }).home_win);
});

test('makeRng produce valori în [0,1)', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 500; i++) { const v = rng(); assert.ok(v >= 0 && v < 1); }
});

test('upsetProbability identifică outsiderul corect', () => {
  const sim = simulate(dixonColesMatrix(2.4, 0.8), { simulations: 20000, seed: 3 });
  const up = upsetProbability(sim, { byGoals: 2 });
  assert.equal(up.side, 'away');
  assert.ok(up.probability > 0 && up.probability < sim.away_win);
});

test('ensemble.blend normalizează ponderile și exclude sursele lipsă', () => {
  const r = blend(
    { dixonColes: { home_win: 0.6, draw: 0.25, away_win: 0.15 }, elo: { home_win: 0.5, draw: 0.3, away_win: 0.2 }, poisson: null },
    { dixonColes: 0.6, elo: 0.4, poisson: 0.2 }
  );
  close(r.home_win + r.draw + r.away_win, 1, 1e-9);
  close(r.home_win, 0.6 * 0.6 + 0.4 * 0.5, 1e-9);
  assert.deepEqual(r.models_used, ['dixonColes', 'elo']);
  assert.equal(r.prediction, '1');
});

test('ensemble.blend aruncă dacă nu există nicio sursă', () => {
  assert.throws(() => blend({ elo: null }, { elo: 0.5 }), /nicio sursă/);
});

test('agreement raportează consensul între modele', () => {
  const a = agreement({
    dixonColes: { home_win: 0.6, draw: 0.2, away_win: 0.2 },
    elo: { home_win: 0.55, draw: 0.25, away_win: 0.2 },
    poisson: { home_win: 0.3, draw: 0.3, away_win: 0.4 },
  });
  assert.equal(a.consensus, '1');
  assert.equal(a.models_count, 3);
  assert.equal(a.models_for, 2);
  assert.equal(a.agreement_pct, 67);
});
