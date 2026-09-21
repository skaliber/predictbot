/**
 * Decontarea pariurilor Asian Handicap.
 *
 * Liniile de sfert (−0.25, −0.75, …) împart miza în două jumătăți pe liniile
 * vecine, deci există patru rezultate în plus față de „câștig / pierdere":
 * jumătate câștig, egalitate (miza se întoarce), jumătate pierdere.
 *
 * Handicapul e exprimat din perspectiva GAZDELOR, ca în football-data.co.uk:
 * AHh = −0.5 înseamnă că gazdele pornesc cu 0.5 goluri în minus.
 */

/** Marja pariului, din perspectiva părții alese. */
export function handicapMargin({ homeGoals, awayGoals, line, side }) {
  const diff = homeGoals - awayGoals;
  return side === 'home' ? diff + line : -diff - line;
}

/**
 * Returul pentru o miză de 1 unitate. 1 = miza înapoi, 0 = pierdere totală.
 *
 *   margin >  0.25  → câștig complet         → cota
 *   margin == 0.25  → jumătate câștig        → (cota + 1) / 2
 *   margin == 0     → egalitate              → 1
 *   margin == -0.25 → jumătate pierdere      → 0.5
 *   margin < -0.25  → pierdere completă      → 0
 */
export function settleHandicap({ homeGoals, awayGoals, line, side, odds }) {
  if (!(odds > 1)) return null;
  const margin = handicapMargin({ homeGoals, awayGoals, line, side });
  // Marjele sunt multipli de 0.25, dar aritmetica în virgulă mobilă poate da
  // 0.24999999 — comparăm cu toleranță, altfel un „push" devine pierdere.
  const eq = (a, b) => Math.abs(a - b) < 1e-9;

  let ret;
  if (margin > 0.25 && !eq(margin, 0.25)) ret = odds;
  else if (eq(margin, 0.25)) ret = (odds + 1) / 2;
  else if (eq(margin, 0)) ret = 1;
  else if (eq(margin, -0.25)) ret = 0.5;
  else ret = 0;

  return {
    margin,
    return: ret,
    profit: ret - 1,
    outcome: eq(margin, 0) ? 'push'
      : eq(margin, 0.25) ? 'half_win'
      : eq(margin, -0.25) ? 'half_loss'
      : margin > 0 ? 'win' : 'loss',
  };
}

/**
 * Probabilitatea modelului ca partea aleasă să acopere handicapul, din
 * matricea de scoruri. Liniile de sfert se tratează ca media celor două
 * linii vecine — exact cum se decontează.
 */
export function coverProbability({ matrix, line, side }) {
  if (!Array.isArray(matrix)) return null;
  // Pe o linie de sfert, media probabilităților pe cele două jumătăți.
  const quarter = Math.abs((line * 4) % 2) === 1;
  const lines = quarter ? [line - 0.25, line + 0.25] : [line];

  const probFor = (l) => {
    let win = 0, push = 0;
    for (let h = 0; h < matrix.length; h++) {
      for (let a = 0; a < matrix[h].length; a++) {
        const p = matrix[h][a];
        if (!(p > 0)) continue;
        const m = handicapMargin({ homeGoals: h, awayGoals: a, line: l, side });
        if (Math.abs(m) < 1e-9) push += p;
        else if (m > 0) win += p;
      }
    }
    // Probabilitatea condiționată de a nu fi egalitate — egalitatea întoarce miza.
    return push >= 1 ? 0.5 : win / (1 - push);
  };

  return lines.reduce((s, l) => s + probFor(l), 0) / lines.length;
}

export default { handicapMargin, settleHandicap, coverProbability };
