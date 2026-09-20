/**
 * Personalități de boți. Fiecare personalitate schimbă TREI lucruri:
 *   1. ponderile de blending între modele (`weights`),
 *   2. ajustarea probabilităților pe baza contextului (`adjust`),
 *   3. politica de selecție a pieței + vocea din reasoning (`policy`, `voice`).
 *
 * Diferențierea e reală: două personalități pe același meci pot alege piețe diferite.
 */

/** Media golurilor marcate/primite în ultimele N meciuri de formă. */
function formStats(form = []) {
  if (!form.length) return null;
  const gf = form.reduce((s, m) => s + (m.goals_for ?? 0), 0) / form.length;
  const ga = form.reduce((s, m) => s + (m.goals_against ?? 0), 0) / form.length;
  const pts = form.reduce((s, m) => s + (m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0), 0);
  return { goals_for: gf, goals_against: ga, points: pts, max_points: form.length * 3, matches: form.length };
}

/** Deplasează probabilitățile 1X2 cu un delta pe gazde/oaspeți, păstrând suma 1. */
function shift1x2(probs, { home = 0, away = 0, draw = 0 }) {
  const out = {
    home_win: Math.max(0.01, probs.home_win + home),
    draw: Math.max(0.01, probs.draw + draw),
    away_win: Math.max(0.01, probs.away_win + away),
  };
  const t = out.home_win + out.draw + out.away_win;
  return { home_win: out.home_win / t, draw: out.draw / t, away_win: out.away_win / t };
}

export const personalities = {
  'ai-analyst': {
    id: 'ai-analyst',
    name: 'AI Analyst',
    tagline: 'Compară toate modelele înainte să decidă și explică de ce.',
    weights: { dixonColes: 0.4, elo: 0.3, poisson: 0.2, predictcamp: 0.1 },
    policy: { markets: ['1x2', 'over_under', 'btts'], minEdgePct: 3, minConfidence: 52, kellyFraction: 0.25 },
    voice: 'analytic',
    adjust: (probs) => probs,
  },

  statisticianul: {
    id: 'statisticianul',
    name: 'Statisticianul',
    tagline: 'Conservator. Crede în medii pe sezon, nu în povești.',
    weights: { poisson: 0.45, dixonColes: 0.3, predictcamp: 0.15, elo: 0.1 },
    policy: { markets: ['1x2', 'over_under'], minEdgePct: 4, minConfidence: 58, kellyFraction: 0.15, avoidDraw: true },
    voice: 'sober',
    adjust: (probs) => shift1x2(probs, { draw: 0.01 }), // ușor pro-egal: regresie la medie
  },

  'forma-zilei': {
    id: 'forma-zilei',
    name: 'Forma Zilei',
    tagline: 'Momentum. Ultimele 5 meciuri bat clasamentul.',
    weights: { elo: 0.4, dixonColes: 0.3, poisson: 0.2, predictcamp: 0.1 },
    policy: { markets: ['1x2', 'over_under', 'btts'], minEdgePct: 2, minConfidence: 50, kellyFraction: 0.2 },
    voice: 'energetic',
    adjust: (probs, ctx) => {
      const h = formStats(ctx?.home_form), a = formStats(ctx?.away_form);
      if (!h || !a) return probs;
      // Diferența de puncte din formă, normalizată, mutată în probabilități (max ±8pp).
      const delta = ((h.points / h.max_points) - (a.points / a.max_points)) * 0.08;
      return shift1x2(probs, { home: delta, away: -delta });
    },
  },

  istoricul: {
    id: 'istoricul',
    name: 'Istoricul',
    tagline: 'Obsedat de H2H. Ce s-a întâmplat de 10 ori se repetă.',
    weights: { dixonColes: 0.35, poisson: 0.25, elo: 0.2, predictcamp: 0.2 },
    policy: { markets: ['1x2', 'over_under'], minEdgePct: 3, minConfidence: 54, kellyFraction: 0.2 },
    voice: 'historic',
    adjust: (probs, ctx) => {
      const h2h = ctx?.h2h;
      if (!h2h?.matches_analyzed) return probs;
      const n = h2h.matches_analyzed;
      // Ponderea H2H crește cu mărimea eșantionului, plafonată la 25%.
      const w = Math.min(0.25, n / 40);
      const hist = {
        home_win: (h2h.home_wins ?? 0) / n,
        draw: (h2h.draws ?? 0) / n,
        away_win: (h2h.away_wins ?? 0) / n,
      };
      return {
        home_win: probs.home_win * (1 - w) + hist.home_win * w,
        draw: probs.draw * (1 - w) + hist.draw * w,
        away_win: probs.away_win * (1 - w) + hist.away_win * w,
      };
    },
  },

  matematicianul: {
    id: 'matematicianul',
    name: 'Matematicianul',
    tagline: 'Dixon-Coles pur, cu time decay. Restul e zgomot.',
    weights: { dixonColes: 0.85, poisson: 0.15 },
    policy: { markets: ['1x2', 'over_under', 'btts', 'correct_score'], minEdgePct: 3, minConfidence: 50, kellyFraction: 0.25 },
    voice: 'mathematical',
    adjust: (probs) => probs,
  },

  'value-hunter': {
    id: 'value-hunter',
    name: 'Value Hunter',
    tagline: 'Nu pariază pe rezultat, pariază pe preț greșit.',
    weights: { dixonColes: 0.35, elo: 0.25, poisson: 0.2, predictcamp: 0.2 },
    // Nu are prag de încredere: contează doar edge-ul vs piață.
    policy: { markets: ['1x2', 'over_under', 'btts'], minEdgePct: 5, minConfidence: 0, kellyFraction: 0.3, requireOdds: true, rankBy: 'edge' },
    voice: 'value',
    adjust: (probs) => probs,
  },

  'underdog-lover': {
    id: 'underdog-lover',
    name: 'Underdog Lover',
    tagline: 'Contrarian. Caută cozile din Monte Carlo pe care piața le ignoră.',
    weights: { dixonColes: 0.4, poisson: 0.3, elo: 0.15, predictcamp: 0.15 },
    policy: { markets: ['1x2', 'btts'], minEdgePct: 4, minConfidence: 0, kellyFraction: 0.15, rankBy: 'edge', preferUnderdog: true },
    voice: 'contrarian',
    adjust: (probs) => {
      // Piața și modelele subestimează sistematic outsiderii (favourite-longshot bias);
      // mută 3pp de la favorit spre outsider.
      const underdogIsAway = probs.home_win >= probs.away_win;
      return shift1x2(probs, underdogIsAway ? { home: -0.03, away: 0.03 } : { home: 0.03, away: -0.03 });
    },
  },
};

export function getPersonality(id) {
  const p = personalities[id];
  if (!p) throw new Error(`personalitate necunoscută: ${id} (disponibile: ${Object.keys(personalities).join(', ')})`);
  return p;
}

export { formStats, shift1x2 };
export default personalities;
