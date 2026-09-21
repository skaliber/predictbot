/**
 * Fallback pe dublă șansă — „damage control", nu strategie profitabilă.
 *
 * Măsurat walk-forward pe 9.158 de pick-uri (vezi RESEARCH.md):
 *   dublă șansă, încredere ≥60% → 88.5% rată de reușită, cotă 1.12,
 *   ROI −1.4% [−2.9, +0.1]
 *
 * E cea mai mică pierdere găsită în ~50.000 de pariuri simulate. Rămâne
 * pierdere. Nu e activat implicit și nu schimbă mizele — dacă ar fi tratat ca
 * „aproape profit", tentația e să crești miza, iar asta amplifică pierderea.
 */
import { doubleChanceOdds } from '../lib/combinedMarkets.js';

/** Pragul sub care fallback-ul nu se aplică — sub el nu s-a măsurat avantaj. */
export const MIN_CONFIDENCE = Number(process.env.DOUBLE_CHANCE_MIN_CONFIDENCE ?? 60);

/** Implicit OPRIT: modul de bază e research, nu pariuri. */
export const ENABLED = process.env.ALLOW_DOUBLE_CHANCE_FALLBACK === 'true';

export const WARNING = 'ROI măsurat −1.4% — nu e profitabil, doar mai puțin volatil decât 1X2.';

/** Perechea de dublă șansă pentru un pick, după partea mai puternică. */
export function pairFor({ homeWinPct, awayWinPct }) {
  if (!Number.isFinite(homeWinPct) || !Number.isFinite(awayWinPct)) return null;
  return homeWinPct > awayWinPct ? '1X' : 'X2';
}

/** Probabilitatea combinată a perechii, din probabilitățile 1X2. */
export function pairProbability(pair, { homeWinPct, drawPct, awayWinPct }) {
  if (pair === '1X') return homeWinPct + drawPct;
  if (pair === 'X2') return drawPct + awayWinPct;
  return null;
}

/**
 * Convertește un pick 1X2 în dublă șansă, dacă sunt îndeplinite condițiile.
 * Întoarce null când nu se aplică — apelantul păstrează pick-ul original.
 *
 * @param {object} args
 * @param {object} args.pick       pick-ul 1X2 selectat
 * @param {object} args.probs      probabilitățile în procente (0–100)
 * @param {number[]} args.odds1x2  cotele 1X2 de piață, pentru replicare
 * @param {boolean} [args.enabled] suprascrie flagul de mediu (pentru teste)
 */
export function toDoubleChance({ pick, probs, odds1x2, enabled = ENABLED, minConfidence = MIN_CONFIDENCE }) {
  if (!enabled) return null;
  if (!pick || pick.market !== '1x2') return null;
  if (!(pick.model_prob_pct >= minConfidence)) return null;
  if (!Array.isArray(odds1x2)) return null;

  const pair = pairFor(probs);
  if (!pair) return null;
  const odds = doubleChanceOdds(odds1x2, pair);
  if (!odds) return null;
  const prob = pairProbability(pair, probs);
  if (!Number.isFinite(prob)) return null;

  return {
    market: 'double_chance',
    selection: pair,
    label: pair === '1X' ? 'Gazde sau egal' : 'Egal sau oaspeți',
    model_prob_pct: Math.round(prob * 10) / 10,
    book_odds: Math.round(odds * 1000) / 1000,
    // Fără edge: cota e replicată din piață, deci prin construcție nu există
    // discrepanță de preț de exploatat.
    edge_pct: null,
    ev_pct: null,
    kelly_stake: null,
    converted_from: { market: pick.market, selection: pick.selection, prob_pct: pick.model_prob_pct },
    warning: WARNING,
  };
}

export default { toDoubleChance, pairFor, pairProbability, ENABLED, MIN_CONFIDENCE, WARNING };
