/**
 * Conversii de cote + de-vigging. Aceeași semantică cu skill-ul `betting`
 * din machina-sports/sports-skills, reimplementat în JS ca să ruleze headless
 * pe VPS fără dependență de Python.
 */

export function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) throw new Error('cotă americană invalidă');
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

export function decimalToAmerican(decimal) {
  const d = Number(decimal);
  if (!(d > 1)) throw new Error('cotă zecimală invalidă (trebuie > 1)');
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

export function decimalToProbability(decimal) {
  const d = Number(decimal);
  if (!(d > 1)) throw new Error('cotă zecimală invalidă (trebuie > 1)');
  return 1 / d;
}

export function probabilityToDecimal(prob) {
  const p = Number(prob);
  if (!(p > 0 && p < 1)) throw new Error('probabilitate invalidă (0 < p < 1)');
  return 1 / p;
}

/** Normalizează orice format la zecimal. format: 'decimal' | 'american' | 'probability' */
export function toDecimal(odds, format = 'decimal') {
  if (format === 'american') return americanToDecimal(odds);
  if (format === 'probability') return probabilityToDecimal(odds);
  return Number(odds);
}

/** Marja bookmakerului (overround): suma probabilităților implicite − 1. */
export function overround(decimalOdds) {
  const total = decimalOdds.reduce((s, d) => s + decimalToProbability(d), 0);
  return { total_implied: total, vig_pct: (total - 1) * 100 };
}

/**
 * De-vig multiplicativ (proporțional) — metoda standard, rapidă.
 * Împarte fiecare probabilitate implicită la overround.
 */
export function devigProportional(decimalOdds) {
  const implied = decimalOdds.map(decimalToProbability);
  const total = implied.reduce((s, p) => s + p, 0);
  return implied.map((p) => p / total);
}

/**
 * De-vig Shin (1993) — modelează prezența pariorilor informați (z).
 * Mai corect decât proporțional pe piețele cu favorit puternic (longshot bias).
 */
export function devigShin(decimalOdds, { maxIter = 100, tol = 1e-12 } = {}) {
  const implied = decimalOdds.map(decimalToProbability);
  const total = implied.reduce((s, p) => s + p, 0);
  if (total <= 1) return implied.map((p) => p / total);

  // p_i(z) = [√(z² + 4(1−z)·π_i²/Π) − z] / (2(1−z))
  const probsFor = (z) => implied.map(
    (p) => (Math.sqrt(z * z + 4 * (1 - z) * (p * p) / total) - z) / (2 * (1 - z))
  );
  const sumFor = (z) => probsFor(z).reduce((s, p) => s + p, 0);

  // Σp_i(z) scade monoton în z: z=0 dă Π > 1, deci căutăm rădăcina prin bisecție.
  let lo = 0, hi = 0.5;
  if (sumFor(hi) > 1) hi = 0.9; // piețe extrem de încărcate
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const s = sumFor(mid);
    if (Math.abs(s - 1) < tol) { lo = hi = mid; break; }
    if (s > 1) lo = mid; else hi = mid;
  }
  const z = (lo + hi) / 2;
  const probs = probsFor(z);
  const sum = probs.reduce((s, p) => s + p, 0);
  return probs.map((p) => p / sum);
}

/**
 * De-vig, cu alegerea metodei.
 * @param {number[]|string[]} odds cotele pentru toate rezultatele pieței
 */
export function devig(odds, { format = 'decimal', method = 'shin', labels } = {}) {
  const decimals = odds.map((o) => toDecimal(o, format));
  if (decimals.some((d) => !(d > 1))) throw new Error('devig: toate cotele trebuie să fie > 1 în format zecimal');
  const fair = method === 'proportional' ? devigProportional(decimals) : devigShin(decimals);
  const { total_implied, vig_pct } = overround(decimals);
  return {
    method,
    fair_probabilities: fair,
    fair_odds: fair.map((p) => 1 / p),
    implied_probabilities: decimals.map(decimalToProbability),
    total_implied,
    vig_pct,
    ...(labels ? { by_label: Object.fromEntries(labels.map((l, i) => [l, fair[i]])) } : {}),
  };
}

export default {
  americanToDecimal, decimalToAmerican, decimalToProbability, probabilityToDecimal,
  toDecimal, overround, devig, devigProportional, devigShin,
};
