/**
 * Dixon-Coles (1997) — Poisson bivariat cu corecție tau pentru scoruri mici
 * și time decay exponențial pe meciurile istorice.
 *
 * Adaptat după implementările publice de referință (sanmati1997/world-cup-2026-predictor,
 * GeorgiosLymperis/football-predictor), rescris în JS fără dependențe.
 *
 *   P(x, y) = tau(x, y, λ, μ, ρ) · Pois(x; λ) · Pois(y; μ)
 *   λ = exp(attack_home + defence_away + gamma)      (gamma = avantaj teren propriu)
 *   μ = exp(attack_away + defence_home)
 */
import { poissonPmf, marketsFromMatrix } from './poisson.js';

/** Corecția Dixon-Coles pentru dependența scorurilor 0-0, 0-1, 1-0, 1-1. */
export function tau(x, y, lambda, mu, rho) {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** Ponderea time-decay: φ(t) = exp(-ξ · zile). ξ≈0.0065/zi ≈ half-life ~107 zile. */
export function timeDecayWeight(matchDate, referenceDate, xi = 0.0065) {
  const days = (new Date(referenceDate) - new Date(matchDate)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.exp(-xi * days);
}

export function dixonColesMatrix(lambdaHome, lambdaAway, rho = -0.03, maxGoals = 10) {
  const m = [];
  let total = 0;
  for (let x = 0; x <= maxGoals; x++) {
    m[x] = [];
    for (let y = 0; y <= maxGoals; y++) {
      const p = Math.max(0, tau(x, y, lambdaHome, lambdaAway, rho)) *
        poissonPmf(x, lambdaHome) * poissonPmf(y, lambdaAway);
      m[x][y] = p;
      total += p;
    }
  }
  for (let x = 0; x <= maxGoals; x++) for (let y = 0; y <= maxGoals; y++) m[x][y] /= total;
  return m;
}

/**
 * Fit al parametrilor prin scaling iterativ multiplicativ (IPF / EM pentru
 * Poisson log-liniar), cu ponderi time-decay — metoda standard pentru
 * Maher (1982) / Dixon-Coles (1997). Converge stabil acolo unde gradient
 * descent pe likelihood-ul complet derivă pe eșantioane mici.
 *
 * Model multiplicativ:  λ = α_gazdă · δ_oaspete · γ ,  μ = α_oaspete · δ_gazdă
 * Actualizări (punct fix):
 *   α_t = Σw·goluri_marcate_t / Σw·δ_adversar·(γ dacă t joacă acasă)
 *   δ_t = Σw·goluri_primite_t / Σw·α_adversar·(γ dacă adversarul joacă acasă)
 *   γ   = Σw·goluri_gazde / Σw·α_gazdă·δ_oaspete
 * ρ se estimează separat, prin căutare 1-D pe likelihood-ul Dixon-Coles
 * cu forțele fixate (practica uzuală, deoarece τ afectează doar scorurile mici).
 *
 * matches: [{ home, away, homeGoals, awayGoals, date }]
 */
export function fitDixonColes(matches, opts = {}) {
  const {
    xi = 0.0065,
    referenceDate = new Date(),
    iterations = 200,
    tolerance = 1e-8,
    fitRho = true,
  } = opts;

  const teams = [...new Set(matches.flatMap((m) => [m.home, m.away]))].sort();
  if (teams.length < 2 || matches.length < 4) {
    throw new Error('fitDixonColes: prea puține meciuri/echipe pentru estimare');
  }

  const weights = matches.map((m) => timeDecayWeight(m.date ?? referenceDate, referenceDate, xi));

  // Totaluri ponderate, calculate o singură dată.
  const scored = new Map(teams.map((t) => [t, 0]));
  const conceded = new Map(teams.map((t) => [t, 0]));
  let homeGoalsTotal = 0, weightTotal = 0;
  matches.forEach((m, i) => {
    const w = weights[i];
    scored.set(m.home, scored.get(m.home) + w * m.homeGoals);
    scored.set(m.away, scored.get(m.away) + w * m.awayGoals);
    conceded.set(m.home, conceded.get(m.home) + w * m.awayGoals);
    conceded.set(m.away, conceded.get(m.away) + w * m.homeGoals);
    homeGoalsTotal += w * m.homeGoals;
    weightTotal += w;
  });

  const alpha = new Map(teams.map((t) => [t, 1]));
  const delta = new Map(teams.map((t) => [t, 1]));
  let gamma = 1.3; // avantaj teren propriu, ~exp(0.26)
  const EPS = 1e-6;

  for (let it = 0; it < iterations; it++) {
    let maxDelta = 0;

    for (const t of teams) {
      let denom = 0;
      matches.forEach((m, i) => {
        if (m.home === t) denom += weights[i] * delta.get(m.away) * gamma;
        else if (m.away === t) denom += weights[i] * delta.get(m.home);
      });
      const next = denom > EPS ? Math.max(EPS, scored.get(t) / denom) : EPS;
      maxDelta = Math.max(maxDelta, Math.abs(next - alpha.get(t)));
      alpha.set(t, next);
    }

    for (const t of teams) {
      let denom = 0;
      matches.forEach((m, i) => {
        if (m.home === t) denom += weights[i] * alpha.get(m.away);
        else if (m.away === t) denom += weights[i] * alpha.get(m.home) * gamma;
      });
      const next = denom > EPS ? Math.max(EPS, conceded.get(t) / denom) : EPS;
      maxDelta = Math.max(maxDelta, Math.abs(next - delta.get(t)));
      delta.set(t, next);
    }

    let gammaDenom = 0;
    matches.forEach((m, i) => { gammaDenom += weights[i] * alpha.get(m.home) * delta.get(m.away); });
    if (gammaDenom > EPS) {
      const nextGamma = Math.max(EPS, homeGoalsTotal / gammaDenom);
      maxDelta = Math.max(maxDelta, Math.abs(nextGamma - gamma));
      gamma = nextGamma;
    }

    // Identificabilitate: media geometrică a atacurilor = 1, compensată în apărări.
    const geo = Math.exp([...alpha.values()].reduce((s, v) => s + Math.log(v), 0) / teams.length);
    for (const t of teams) {
      alpha.set(t, alpha.get(t) / geo);
      delta.set(t, delta.get(t) * geo);
    }

    if (maxDelta < tolerance) break;
  }

  // ρ prin căutare pe grilă + rafinare, cu forțele fixate.
  let rho = -0.03;
  if (fitRho) {
    const llForRho = (r) => {
      let ll = 0;
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const lambda = alpha.get(m.home) * delta.get(m.away) * gamma;
        const mu = alpha.get(m.away) * delta.get(m.home);
        const t = tau(m.homeGoals, m.awayGoals, lambda, mu, r);
        if (!(t > 0)) return -Infinity;
        ll += weights[i] * Math.log(t);
      }
      return ll;
    };
    // Grilă pe indici întregi: evită acumularea de eroare în virgulă mobilă
    // care ar putea împinge ρ în afara intervalului [-0.2, 0.2].
    const STEPS = 80;
    let bestRho = 0, bestLl = llForRho(0);
    for (let k = -STEPS; k <= STEPS; k++) {
      const r = (k / STEPS) * 0.2;
      const ll = llForRho(r);
      if (ll > bestLl) { bestLl = ll; bestRho = r; }
    }
    rho = Math.max(-0.2, Math.min(0.2, bestRho));
  }

  const attack = {}, defence = {};
  for (const t of teams) {
    attack[t] = Math.log(alpha.get(t));
    defence[t] = Math.log(delta.get(t));
  }

  // Log-likelihood Dixon-Coles complet, pentru diagnostic/comparație de modele.
  let logLikelihood = 0;
  matches.forEach((m, i) => {
    const lambda = alpha.get(m.home) * delta.get(m.away) * gamma;
    const mu = alpha.get(m.away) * delta.get(m.home);
    const t = Math.max(1e-12, tau(m.homeGoals, m.awayGoals, lambda, mu, rho));
    logLikelihood += weights[i] * (
      Math.log(t) - lambda + m.homeGoals * Math.log(lambda) - mu + m.awayGoals * Math.log(mu)
    );
  });

  return {
    teams, attack, defence,
    gamma: Math.log(gamma),
    rho,
    logLikelihood,
    sampleSize: matches.length,
    effectiveSampleSize: weightTotal,
    xi,
  };
}

/** Lambda-urile pentru un meci, dintr-un fit. */
export function lambdasFromFit(fit, home, away) {
  const atkH = fit.attack[home], defH = fit.defence[home];
  const atkA = fit.attack[away], defA = fit.defence[away];
  if ([atkH, defH, atkA, defA].some((v) => v === undefined)) {
    throw new Error(`lambdasFromFit: echipă necunoscută (${home} / ${away})`);
  }
  return {
    lambdaHome: Math.min(8, Math.exp(atkH + defA + fit.gamma)),
    lambdaAway: Math.min(8, Math.exp(atkA + defH)),
  };
}

/**
 * Predicție Dixon-Coles. Acceptă fie lambda-uri directe (le ia din PredictCamp),
 * fie un fit + numele echipelor.
 */
export function predictDixonColes({ lambdaHome, lambdaAway, rho = -0.03, fit, home, away, maxGoals = 10 }) {
  let lh = lambdaHome, la = lambdaAway, r = rho;
  if (fit && home && away) {
    ({ lambdaHome: lh, lambdaAway: la } = lambdasFromFit(fit, home, away));
    r = fit.rho;
  }
  if (!(lh > 0) || !(la > 0)) throw new Error('predictDixonColes: lambda invalid');
  const matrix = dixonColesMatrix(lh, la, r, maxGoals);
  return {
    model: 'dixon_coles',
    lambda_home: lh,
    lambda_away: la,
    rho: r,
    matrix,
    ...marketsFromMatrix(matrix),
  };
}

export default { tau, timeDecayWeight, dixonColesMatrix, fitDixonColes, lambdasFromFit, predictDixonColes };
