/**
 * Poisson independent — baseline clasic (Maher 1982).
 * Matricea de scoruri P(x,y) = Pois(x; λ_home) * Pois(y; λ_away).
 */

const LOG_FACT = [0];
function logFactorial(n) {
  for (let i = LOG_FACT.length; i <= n; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  return LOG_FACT[n];
}

export function poissonPmf(k, lambda) {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

/** Matrice (maxGoals+1)x(maxGoals+1) de probabilități de scor, normalizată. */
export function scoreMatrix(lambdaHome, lambdaAway, maxGoals = 10) {
  const m = [];
  let total = 0;
  for (let x = 0; x <= maxGoals; x++) {
    m[x] = [];
    for (let y = 0; y <= maxGoals; y++) {
      const p = poissonPmf(x, lambdaHome) * poissonPmf(y, lambdaAway);
      m[x][y] = p;
      total += p;
    }
  }
  // Coada trunchiată peste maxGoals se redistribuie proporțional.
  for (let x = 0; x <= maxGoals; x++) for (let y = 0; y <= maxGoals; y++) m[x][y] /= total;
  return m;
}

/** Agregă o matrice de scoruri în piețele uzuale. Probabilități în fracții [0,1]. */
export function marketsFromMatrix(matrix) {
  const n = matrix.length;
  let home = 0, draw = 0, away = 0, over25 = 0, over15 = 0, over35 = 0, btts = 0;
  const scores = [];
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const p = matrix[x][y];
      if (p <= 0) continue;
      if (x > y) home += p; else if (x === y) draw += p; else away += p;
      const goals = x + y;
      if (goals > 1.5) over15 += p;
      if (goals > 2.5) over25 += p;
      if (goals > 3.5) over35 += p;
      if (x > 0 && y > 0) btts += p;
      scores.push({ score: `${x}-${y}`, prob: p });
    }
  }
  scores.sort((a, b) => b.prob - a.prob);
  return {
    home_win: home,
    draw,
    away_win: away,
    over15,
    over25,
    over35,
    under25: 1 - over25,
    btts_yes: btts,
    btts_no: 1 - btts,
    top_scores: scores.slice(0, 6),
    most_likely_score: scores[0]?.score ?? null,
    expected_goals: scores.reduce((s, it) => {
      const [a, b] = it.score.split('-').map(Number);
      return s + (a + b) * it.prob;
    }, 0),
  };
}

export function predictPoisson({ lambdaHome, lambdaAway, maxGoals = 10 }) {
  const matrix = scoreMatrix(lambdaHome, lambdaAway, maxGoals);
  return { model: 'poisson', lambda_home: lambdaHome, lambda_away: lambdaAway, matrix, ...marketsFromMatrix(matrix) };
}

export default { poissonPmf, scoreMatrix, marketsFromMatrix, predictPoisson };
