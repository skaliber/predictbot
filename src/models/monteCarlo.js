/**
 * Monte Carlo peste matricea Dixon-Coles: eșantionează scoruri din distribuția
 * comună (nu din două Poisson independente), deci păstrează corecția tau.
 */

/** PRNG determinist (mulberry32) — necesar pentru teste reproductibile. */
export function makeRng(seed = 42) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Aplatizează matricea în CDF pentru eșantionare O(log n). */
function buildCdf(matrix) {
  const flat = [];
  let acc = 0;
  for (let x = 0; x < matrix.length; x++) {
    for (let y = 0; y < matrix[x].length; y++) {
      acc += matrix[x][y];
      flat.push({ x, y, cum: acc });
    }
  }
  // Normalizare defensivă împotriva erorilor de rotunjire.
  for (const it of flat) it.cum /= acc;
  flat[flat.length - 1].cum = 1;
  return flat;
}

function sample(cdf, u) {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid].cum < u) lo = mid + 1; else hi = mid;
  }
  return cdf[lo];
}

/**
 * Rulează n simulări și întoarce frecvențele empirice pe piețe.
 * @param {number[][]} matrix matrice de probabilități de scor
 */
export function simulate(matrix, { simulations = 10000, seed = 42 } = {}) {
  const cdf = buildCdf(matrix);
  const rng = makeRng(seed);
  const counts = { home: 0, draw: 0, away: 0, over15: 0, over25: 0, over35: 0, btts: 0 };
  const scoreCounts = new Map();
  const marginCounts = new Map(); // x - y → număr de simulări
  let totalGoals = 0;

  for (let i = 0; i < simulations; i++) {
    const { x, y } = sample(cdf, rng());
    if (x > y) counts.home++; else if (x === y) counts.draw++; else counts.away++;
    const g = x + y;
    totalGoals += g;
    if (g > 1.5) counts.over15++;
    if (g > 2.5) counts.over25++;
    if (g > 3.5) counts.over35++;
    if (x > 0 && y > 0) counts.btts++;
    const key = `${x}-${y}`;
    scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
    marginCounts.set(x - y, (marginCounts.get(x - y) ?? 0) + 1);
  }

  const p = (c) => c / simulations;
  const topScores = [...scoreCounts.entries()]
    .map(([score, c]) => ({ score, prob: p(c) }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 6);

  return {
    model: 'monte_carlo',
    simulations,
    home_win: p(counts.home),
    draw: p(counts.draw),
    away_win: p(counts.away),
    over15: p(counts.over15),
    over25: p(counts.over25),
    over35: p(counts.over35),
    under25: 1 - p(counts.over25),
    btts_yes: p(counts.btts),
    btts_no: 1 - p(counts.btts),
    expected_goals: totalGoals / simulations,
    top_scores: topScores,
    most_likely_score: topScores[0]?.score ?? null,
    /** Distribuția marjei (goluri_gazde − goluri_oaspeți), pentru analiza cozilor. */
    margin_distribution: Object.fromEntries(
      [...marginCounts.entries()].sort((a, b) => a[0] - b[0]).map(([m, c]) => [m, p(c)])
    ),
  };
}

/**
 * Probabilitatea „upset”: outsiderul (după probabilitățile simulate) câștigă
 * cu o marjă de cel puțin `byGoals`. Folosit de personalitatea Underdog Lover.
 */
export function upsetProbability(sim, { byGoals = 2 } = {}) {
  const underdogIsAway = sim.home_win >= sim.away_win;
  let acc = 0;
  for (const [margin, prob] of Object.entries(sim.margin_distribution ?? {})) {
    const m = Number(margin);
    if (underdogIsAway ? m <= -byGoals : m >= byGoals) acc += prob;
  }
  return { side: underdogIsAway ? 'away' : 'home', by_goals: byGoals, probability: acc };
}

export default { simulate, makeRng, upsetProbability };
