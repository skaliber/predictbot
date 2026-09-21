/**
 * Reconstruiește `granular-stats` la o dată din trecut, din rezultate anterioare.
 *
 * Endpoint-ul real se calculează ACUM, deci pentru un meci vechi include meciuri
 * de după el — leakage. Aici numărăm doar ce se întâmplase până la kickoff,
 * păstrând exact forma pe care o consumă `granularMarkets()`.
 */

/** Ultimele `n` meciuri ale unei echipe, strict anterioare. */
function lastMatches(history, team, n) {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < n; i--) {
    const m = history[i];
    if (m.home === team || m.away === team) out.push(m);
  }
  return out;
}

const isOver = (m, line) => m.homeGoals + m.awayGoals > line;
const isBtts = (m) => m.homeGoals > 0 && m.awayGoals > 0;

/** Procentul de meciuri care satisfac un predicat. */
function rate(matches, pred) {
  if (!matches.length) return null;
  return (matches.filter(pred).length / matches.length) * 100;
}

/**
 * @param {Array} history meciuri strict anterioare, cronologic
 * @param {string} home
 * @param {string} away
 * @param {object} [opts] { window: câte meciuri per echipă, minSample }
 * @returns forma consumată de `granularMarkets()`, sau null dacă e prea devreme
 */
export function historicalGranular(history, home, away, { window = 10, minSample = 6 } = {}) {
  const h = lastMatches(history, home, window);
  const a = lastMatches(history, away, window);
  if (h.length < minSample || a.length < minSample) return null;

  const combined = [...h, ...a];
  const over25 = rate(combined, (m) => isOver(m, 2.5));
  const btts = rate(combined, isBtts);

  // Baseline-ul ligii: toate meciurile din fereastra de antrenare.
  const baseOver = rate(history, (m) => isOver(m, 2.5));
  const baseBtts = rate(history, isBtts);
  if (baseOver === null || baseBtts === null) return null;

  return {
    prediction_summary: {
      markets: [
        { market: 'over_2_5', value_pct: over25, league_baseline_pct: baseOver, sample_size: combined.length },
        { market: 'btts', value_pct: btts, league_baseline_pct: baseBtts, sample_size: combined.length },
      ],
    },
    _meta: { home_sample: h.length, away_sample: a.length, league_sample: history.length },
  };
}

/** Rezultatul real al unei piețe alternative, pentru validare. */
export function altMarketOutcome(match, selection) {
  const total = match.homeGoals + match.awayGoals;
  switch (selection) {
    case 'Over 2.5': return total > 2.5;
    case 'Under 2.5': return total < 2.5;
    case 'BTTS Yes': return match.homeGoals > 0 && match.awayGoals > 0;
    case 'BTTS No': return !(match.homeGoals > 0 && match.awayGoals > 0);
    default: return null;
  }
}

export default { historicalGranular, altMarketOutcome };
