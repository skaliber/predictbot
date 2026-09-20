/**
 * Blending ponderat al modelelor pe piața 1X2 (și pe piețele secundare când
 * sursele le expun). Sursele lipsă sunt excluse, ponderile se re-normalizează.
 */
import config from '../config.js';

const MARKETS_1X2 = ['home_win', 'draw', 'away_win'];

function normalize(obj, keys) {
  const total = keys.reduce((s, k) => s + (obj[k] ?? 0), 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(keys.map((k) => [k, (obj[k] ?? 0) / total]));
}

/**
 * @param {Record<string, object>} sources ex. { dixonColes: {...}, elo: {...} }
 * @param {Record<string, number>} weights ponderi brute pe sursă
 */
export function blend(sources, weights = config.ensembleWeights) {
  const used = [];
  const excluded = [];
  let weightSum = 0;
  const acc = { home_win: 0, draw: 0, away_win: 0 };
  const secondary = {};
  const secondaryWeight = {};

  for (const [name, src] of Object.entries(sources)) {
    const w = weights[name];
    const probs = src && normalize(src, MARKETS_1X2);
    if (!w || w <= 0 || !probs) { if (src !== undefined) excluded.push(name); continue; }
    weightSum += w;
    used.push({ source: name, weight: w });
    for (const k of MARKETS_1X2) acc[k] += w * probs[k];
    for (const k of ['over25', 'under25', 'btts_yes', 'btts_no', 'over15', 'over35']) {
      if (typeof src[k] === 'number' && Number.isFinite(src[k])) {
        secondary[k] = (secondary[k] ?? 0) + w * src[k];
        secondaryWeight[k] = (secondaryWeight[k] ?? 0) + w;
      }
    }
  }

  if (weightSum === 0) throw new Error('ensemble.blend: nicio sursă utilizabilă');
  for (const k of MARKETS_1X2) acc[k] /= weightSum;
  for (const k of Object.keys(secondary)) secondary[k] /= secondaryWeight[k];

  const picks = MARKETS_1X2.map((k) => [k, acc[k]]).sort((a, b) => b[1] - a[1]);
  const label = { home_win: '1', draw: 'X', away_win: '2' }[picks[0][0]];

  return {
    model: 'ensemble',
    ...acc,
    ...secondary,
    prediction: label,
    confidence: Math.round(picks[0][1] * 1000) / 10,
    models_used: used.map((u) => u.source),
    excluded_sources: excluded,
    weights: Object.fromEntries(used.map((u) => [u.source, Math.round((u.weight / weightSum) * 1e4) / 1e4])),
  };
}

/** Acord între modele pe 1X2: cât de multe surse votează același rezultat. */
export function agreement(sources) {
  const votes = [];
  for (const [name, src] of Object.entries(sources)) {
    const probs = src && normalize(src, MARKETS_1X2);
    if (!probs) continue;
    const top = MARKETS_1X2.map((k) => [k, probs[k]]).sort((a, b) => b[1] - a[1])[0];
    votes.push({ model: name, prediction: { home_win: '1', draw: 'X', away_win: '2' }[top[0]], prob: top[1] });
  }
  if (!votes.length) return { available: false };
  const tally = votes.reduce((m, v) => ({ ...m, [v.prediction]: (m[v.prediction] ?? 0) + 1 }), {});
  const [best, count] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const agreementPct = Math.round((count / votes.length) * 100);
  const meanTopProb = votes.filter((v) => v.prediction === best).reduce((s, v) => s + v.prob, 0) / count;
  return {
    available: true,
    consensus: best,
    agreement_pct: agreementPct,
    models_count: votes.length,
    models_for: count,
    mean_top_prob_pct: Math.round(meanTopProb * 1000) / 10,
    signal: agreementPct >= 75 && meanTopProb >= 0.5 ? 'STRONG' : agreementPct >= 60 ? 'MODERATE' : 'WEAK',
    sources: votes.map((v) => ({ model: v.model, prediction: v.prediction })),
  };
}

export default { blend, agreement };
