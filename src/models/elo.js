/**
 * Elo pentru fotbal, cu probabilitate de egal derivată din diferența de rating.
 * Formula de egal: draw = c · exp(-(diff/d)^2) — calibrată empiric pe ligile top
 * (~28% la diff 0, scade spre ~10% la diff 400).
 */
const HOME_ADVANTAGE = 65;

export function expectedScore(ratingHome, ratingAway, homeAdvantage = HOME_ADVANTAGE) {
  const diff = ratingHome + homeAdvantage - ratingAway;
  return 1 / (1 + 10 ** (-diff / 400));
}

export function eloProbabilities(ratingHome, ratingAway, homeAdvantage = HOME_ADVANTAGE) {
  const diff = ratingHome + homeAdvantage - ratingAway;
  const exp = 1 / (1 + 10 ** (-diff / 400));
  const draw = 0.29 * Math.exp(-((diff / 420) ** 2));
  const rest = 1 - draw;
  // Se distribuie restul proporțional cu scorul așteptat.
  const home = rest * exp;
  const away = rest * (1 - exp);
  return { home_win: home, draw, away_win: away, diff, expected: exp };
}

/** Actualizare Elo după un meci, cu K scalat pe diferența de goluri (ca la FIFA/ClubElo). */
export function updateElo(ratingHome, ratingAway, homeGoals, awayGoals, { k = 20, homeAdvantage = HOME_ADVANTAGE } = {}) {
  const exp = expectedScore(ratingHome, ratingAway, homeAdvantage);
  const actual = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
  const margin = Math.abs(homeGoals - awayGoals);
  const multiplier = margin <= 1 ? 1 : margin === 2 ? 1.5 : (11 + margin) / 8;
  const delta = k * multiplier * (actual - exp);
  return { home: ratingHome + delta, away: ratingAway - delta, delta };
}

/** Construiește ratinguri Elo dintr-un istoric de meciuri ordonat cronologic. */
export function buildRatings(matches, { start = 1500, k = 20 } = {}) {
  const ratings = new Map();
  const get = (t) => (ratings.has(t) ? ratings.get(t) : start);
  const ordered = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const m of ordered) {
    const { home, away } = updateElo(get(m.home), get(m.away), m.homeGoals, m.awayGoals, { k });
    ratings.set(m.home, home);
    ratings.set(m.away, away);
  }
  return Object.fromEntries(ratings);
}

export function predictElo({ ratingHome, ratingAway, homeAdvantage = HOME_ADVANTAGE }) {
  const p = eloProbabilities(ratingHome, ratingAway, homeAdvantage);
  return { model: 'elo', home_rating: ratingHome, away_rating: ratingAway, ...p };
}

export default { expectedScore, eloProbabilities, updateElo, buildRatings, predictElo, HOME_ADVANTAGE };
