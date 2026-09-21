/**
 * Unelte pentru testarea ipotezelor de piață. Aici nu intervine niciun model —
 * doar cote și rezultate, deci eșantionul e tot ce există în bază.
 */

/**
 * ROI pentru o strategie de pariu plat (1 unitate), cu eroare standard.
 * Fără eroarea standard, un ROI pe 30 de pariuri arată la fel ca unul pe 3000.
 */
export function flatRoi(bets) {
  if (!bets.length) return null;
  const profits = bets.map((b) => (b.hit ? b.odds - 1 : -1));
  const mean = profits.reduce((a, c) => a + c, 0) / profits.length;
  const variance = profits.reduce((a, c) => a + (c - mean) ** 2, 0) / Math.max(1, profits.length - 1);
  const se = Math.sqrt(variance / profits.length);
  return {
    n: bets.length,
    roi_pct: mean * 100,
    se_pct: se * 100,
    // Cât de departe de zero, în erori standard. Peste ~2 devine interesant.
    t: se > 0 ? mean / se : 0,
    hit_rate_pct: (bets.filter((b) => b.hit).length / bets.length) * 100,
    mean_odds: bets.reduce((a, b) => a + b.odds, 0) / bets.length,
  };
}

/** Marja bookmakerului pe un set de cote (suma probabilităților implicite − 1). */
export function margin(odds) {
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}

/** Împarte pariurile în grupe după o cheie și calculează ROI pe fiecare. */
export function bucketRoi(bets, keyFn, order) {
  const groups = new Map();
  for (const b of bets) {
    const k = keyFn(b);
    if (k === null || k === undefined) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const keys = order ?? [...groups.keys()].sort();
  return keys
    .filter((k) => groups.has(k))
    .map((k) => ({ bucket: k, ...flatRoi(groups.get(k)) }));
}

/** Eticheta de interval pentru o valoare, după praguri. */
export function bucketize(value, edges, labels) {
  for (let i = 0; i < edges.length - 1; i++) {
    if (value >= edges[i] && value < edges[i + 1]) return labels[i];
  }
  return null;
}

export default { flatRoi, margin, bucketRoi, bucketize };
