/**
 * Tracking de acuratețe și ROI peste predicțiile salvate.
 * `settled` = predicții cărora li s-a atașat `result` (vezi scripts/settle.js).
 */

/** Rezultatul real al unei selecții, dat scorul final. */
export function selectionHit(selection, scoreHome, scoreAway) {
  const total = scoreHome + scoreAway;
  switch (selection) {
    case '1': return scoreHome > scoreAway;
    case 'X': return scoreHome === scoreAway;
    case '2': return scoreHome < scoreAway;
    case 'Over 2.5': return total > 2.5;
    case 'Under 2.5': return total < 2.5;
    case 'BTTS Yes': return scoreHome > 0 && scoreAway > 0;
    case 'BTTS No': return !(scoreHome > 0 && scoreAway > 0);
    default: return null;
  }
}

export function summarize(predictions) {
  const bets = predictions.filter((p) => p.selection);
  const settled = bets.filter((p) => p.result && Number.isFinite(p.result.score_home));

  let wins = 0, stakeSum = 0, profitSum = 0, flatProfit = 0;
  const byMarket = {};

  for (const p of settled) {
    const hit = selectionHit(p.selection, p.result.score_home, p.result.score_away);
    if (hit === null) continue;
    const odds = p.candidates?.find((c) => c.selection === p.selection)?.book_odds ?? null;
    const stake = p.kelly_stake ?? 0;
    if (hit) wins++;
    if (odds) {
      stakeSum += stake;
      profitSum += hit ? stake * (odds - 1) : -stake;
      flatProfit += hit ? odds - 1 : -1;
    }
    const m = (byMarket[p.market] ??= { total: 0, wins: 0 });
    m.total++; if (hit) m.wins++;
  }

  const n = settled.length;
  return {
    predictions: predictions.length,
    bets: bets.length,
    no_bets: predictions.length - bets.length,
    settled: n,
    wins,
    accuracy_pct: n ? Math.round((wins / n) * 1000) / 10 : null,
    kelly_roi_pct: stakeSum ? Math.round((profitSum / stakeSum) * 1000) / 10 : null,
    flat_roi_pct: n ? Math.round((flatProfit / n) * 1000) / 10 : null,
    by_market: Object.fromEntries(
      Object.entries(byMarket).map(([k, v]) => [k, { ...v, accuracy_pct: Math.round((v.wins / v.total) * 1000) / 10 }])
    ),
  };
}

export default { summarize, selectionHit };
