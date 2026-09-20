/**
 * Edge detection, expected value, Kelly criterion, arbitraj, parlay.
 */
import { toDecimal, decimalToProbability } from './odds.js';

/**
 * Edge = diferența dintre probabilitatea noastră „fair” și cea a pieței.
 * EV% = randamentul așteptat per unitate mizată la cota oferită.
 */
export function findEdge({ fairProb, marketProb, decimalOdds }) {
  const p = Number(fairProb);
  if (!(p > 0 && p < 1)) throw new Error('findEdge: fairProb trebuie în (0,1)');
  const odds = decimalOdds ?? (marketProb ? 1 / Number(marketProb) : undefined);
  if (!(odds > 1)) throw new Error('findEdge: lipsesc cota sau marketProb');
  const implied = decimalToProbability(odds);
  const ev = p * (odds - 1) - (1 - p);
  return {
    fair_prob: p,
    market_prob: implied,
    decimal_odds: odds,
    edge: p - implied,
    edge_pct: (p - implied) * 100,
    ev: ev,
    ev_pct: ev * 100,
    positive: ev > 0,
  };
}

/**
 * Kelly criterion: f* = (b·p − q) / b, unde b = cotă − 1.
 * `fraction` aplică Kelly fracționat (0.25 = quarter Kelly), `cap` limitează miza.
 */
export function kelly({ prob, decimalOdds, fraction = 1, cap = 1 }) {
  const p = Number(prob);
  const b = Number(decimalOdds) - 1;
  if (!(p > 0 && p < 1)) throw new Error('kelly: prob trebuie în (0,1)');
  if (!(b > 0)) throw new Error('kelly: cota trebuie > 1');
  const full = (b * p - (1 - p)) / b;
  const staked = Math.max(0, full) * fraction;
  return {
    full_kelly: full,
    fraction,
    stake: Math.min(Math.max(0, staked), cap),
    capped: staked > cap,
    edge_positive: full > 0,
  };
}

/** Evaluare completă a unui pariu: de-vig deja aplicat → edge → miza Kelly. */
export function evaluateBet({ fairProb, decimalOdds, kellyFraction = 0.25, maxStake = 0.05 }) {
  const edge = findEdge({ fairProb, decimalOdds });
  const size = kelly({ prob: fairProb, decimalOdds, fraction: kellyFraction, cap: maxStake });
  return { ...edge, kelly_stake: size.stake, full_kelly: size.full_kelly, kelly_fraction: kellyFraction };
}

/**
 * Arbitraj: dacă suma probabilităților implicite ale celor mai bune cote < 1,
 * există profit garantat.
 */
export function findArbitrage(odds, { format = 'decimal', labels } = {}) {
  const decimals = odds.map((o) => toDecimal(o, format));
  const implied = decimals.map(decimalToProbability);
  const total = implied.reduce((s, p) => s + p, 0);
  const exists = total < 1;
  return {
    arbitrage: exists,
    total_implied: total,
    roi_pct: exists ? (1 / total - 1) * 100 : 0,
    stakes: exists
      ? decimals.map((d, i) => ({
          label: labels?.[i] ?? `outcome_${i + 1}`,
          decimal_odds: d,
          stake_fraction: implied[i] / total,
        }))
      : [],
  };
}

/** Analiză parlay: probabilitate combinată (independență asumată) + edge. */
export function parlayAnalysis({ legs, decimalOdds, kellyFraction = 0.25 }) {
  const combined = legs.reduce((s, p) => s * Number(p), 1);
  const edge = findEdge({ fairProb: combined, decimalOdds });
  const size = kelly({ prob: combined, decimalOdds, fraction: kellyFraction });
  return { legs: legs.length, combined_prob: combined, ...edge, kelly_stake: size.stake };
}

export default { findEdge, kelly, evaluateBet, findArbitrage, parlayAnalysis };
