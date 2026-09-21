/**
 * Piețe derivate și combinate: dublă șansă, acumulatoare, mișcarea liniei.
 *
 * Dubla șansă nu există ca preț în football-data.co.uk, dar nu trebuie
 * inventată: se replică exact din piața 1X2. Dacă pariezi pe două rezultate
 * cu mize proporționale cu 1/cotă, returul garantat e
 *
 *     cota_dublă_șansă = 1 / (1/o_a + 1/o_b)
 *
 * Nu e o aproximare — e prețul obtenabil din cotele reale. Un bookmaker care
 * oferă dublă șansă sub valoarea asta e mai scump decât replicarea.
 */

/** Cota sintetică pentru o dublă șansă, din cotele 1X2. */
export function doubleChanceOdds(odds, pair) {
  const idx = { '1X': [0, 1], X2: [1, 2], 12: [0, 2] }[pair];
  if (!idx || !Array.isArray(odds)) return null;
  const [a, b] = idx.map((i) => odds[i]);
  if (!(a > 1) || !(b > 1)) return null;
  return 1 / (1 / a + 1 / b);
}

/** Dubla șansă a ieșit? */
export function doubleChanceHit(pair, outcome) {
  const members = { '1X': ['1', 'X'], X2: ['X', '2'], 12: ['1', '2'] }[pair];
  return members ? members.includes(outcome) : null;
}

/**
 * Acumulator: cota se înmulțește, dar la fel și marja.
 *
 * Dacă fiecare picior are randament așteptat r (ex. −0.05), combinația are
 * (1 + r)^n − 1. Pentru r = −5% și 3 picioare: −14.3%. Marja NU se diluează
 * prin combinare — se compune. Asta e afirmația pe care o testăm pe date reale.
 */
export function accumulator(legs) {
  if (!legs.length) return null;
  const odds = legs.reduce((o, l) => o * l.odds, 1);
  const allHit = legs.every((l) => l.hit);
  return {
    legs: legs.length,
    combined_odds: odds,
    hit: allHit,
    profit: allHit ? odds - 1 : -1,
    mean_leg_odds: legs.reduce((s, l) => s + l.odds, 0) / legs.length,
  };
}

/** Randamentul teoretic al unui acumulator, dacă fiecare picior are ROI `r`. */
export function theoreticalAccumulatorRoi(legRoi, n) {
  return (1 + legRoi) ** n - 1;
}

/**
 * Mișcarea liniei: ce s-a schimbat între deschidere și închidere.
 * `steam` = rezultatul spre care s-au mutat banii (probabilitate în creștere).
 */
export function lineMove(openProbs, closeProbs) {
  if (!openProbs || !closeProbs) return null;
  const deltas = closeProbs.map((c, i) => c - openProbs[i]);
  const maxIdx = deltas.indexOf(Math.max(...deltas));
  const minIdx = deltas.indexOf(Math.min(...deltas));
  return {
    deltas_pp: deltas.map((d) => d * 100),
    steam: ['1', 'X', '2'][maxIdx],
    steam_pp: deltas[maxIdx] * 100,
    drift: ['1', 'X', '2'][minIdx],
    drift_pp: deltas[minIdx] * 100,
    magnitude_pp: (deltas[maxIdx] - deltas[minIdx]) * 100 / 2,
  };
}

export default {
  doubleChanceOdds, doubleChanceHit, accumulator,
  theoreticalAccumulatorRoi, lineMove,
};
