/**
 * Pipeline-ul de decizie al botului:
 *   1. bundle PredictCamp (models + context + bots + ml)
 *   2. reconstruire locală Dixon-Coles / Poisson / Elo din lambda & ratinguri
 *   3. Monte Carlo 10k peste matricea Dixon-Coles
 *   4. ensemble ponderat pe personalitate + ajustare de context
 *   5. de-vig cotelor → edge → Kelly
 *   6. selecția pieței după politica personalității
 */
import config from '../config.js';
import { predictPoisson } from '../models/poisson.js';
import { predictDixonColes } from '../models/dixonColes.js';
import { predictElo } from '../models/elo.js';
import { simulate, upsetProbability } from '../models/monteCarlo.js';
import { blend, agreement } from '../models/ensemble.js';
import { devig } from '../betting/odds.js';
import { evaluateBet } from '../betting/kelly.js';
import { getPersonality } from './personalities.js';
import { toDoubleChance } from './doubleChance.js';
import { buildReasoning } from './reasoning.js';

const pct = (x) => Math.round(x * 1000) / 10;
const fromPct = (x) => (typeof x === 'number' ? x / 100 : undefined);

/** Normalizează blocul `models` din API (procente 0–100) în surse fracționare. */
export function buildModelSources(models, { simulations = 10000, seed = 42 } = {}) {
  const sources = {};
  const detail = {};

  const dcLambdas = models?.elitul?.dixon_coles;
  if (dcLambdas?.lambda_home > 0 && dcLambdas?.lambda_away > 0) {
    const dc = predictDixonColes({ lambdaHome: dcLambdas.lambda_home, lambdaAway: dcLambdas.lambda_away });
    sources.dixonColes = dc;
    detail.dixon_coles = {
      lambda_home: dc.lambda_home, lambda_away: dc.lambda_away, rho: dc.rho,
      expected_goals: dc.expected_goals, most_likely_score: dc.most_likely_score,
      top_scores: dc.top_scores.map((s) => ({ score: s.score, prob_pct: pct(s.prob) })),
      data_sufficiency: dcLambdas.data_sufficiency ?? null,
    };
    const mc = simulate(dc.matrix, { simulations, seed });
    sources.monteCarlo = mc;
    detail.monte_carlo = {
      simulations: mc.simulations,
      home_win_pct: pct(mc.home_win), draw_pct: pct(mc.draw), away_win_pct: pct(mc.away_win),
      over25_pct: pct(mc.over25), btts_pct: pct(mc.btts_yes),
      expected_goals: Math.round(mc.expected_goals * 100) / 100,
      most_likely_score: mc.most_likely_score,
      upset: upsetProbability(mc, { byGoals: 2 }),
    };
  }

  const po = models?.poisson;
  if (po?.lambda_home > 0 && po?.lambda_away > 0) {
    const p = predictPoisson({ lambdaHome: po.lambda_home, lambdaAway: po.lambda_away });
    sources.poisson = p;
    detail.poisson = {
      lambda_home: p.lambda_home, lambda_away: p.lambda_away,
      expected_goals: p.expected_goals, most_likely_score: p.most_likely_score,
    };
  }

  const elo = models?.elo;
  if (Number.isFinite(elo?.home_rating) && Number.isFinite(elo?.away_rating)) {
    const e = predictElo({ ratingHome: elo.home_rating, ratingAway: elo.away_rating });
    sources.elo = e;
    detail.elo = { home_rating: elo.home_rating, away_rating: elo.away_rating, diff: elo.diff ?? e.diff };
  }

  const ens = models?.ensemble;
  if (ens?.available && Number.isFinite(ens.home_win_prob)) {
    sources.predictcamp = {
      home_win: fromPct(ens.home_win_prob),
      draw: fromPct(ens.draw_prob),
      away_win: fromPct(ens.away_win_prob),
    };
    detail.predictcamp_ensemble = {
      prediction: ens.prediction, confidence: ens.confidence,
      calibrated: ens.calibrated, models_used: ens.models_used,
    };
  }

  return { sources, detail };
}

/**
 * ML 1X2 calibrat ca sursă suplimentară de ensemble.
 * Acoperă doar PL/LaLiga/Bundesliga/Serie A/Ligue 1 și poate fi oprit
 * site-wide — de aceea e opțional și nu blochează predicția.
 */
export function mlSource(ml) {
  const p = ml?.prediction ?? ml;
  const home = p?.home_win_prob, draw = p?.draw_prob, away = p?.away_win_prob;
  if (![home, draw, away].every((x) => Number.isFinite(x))) return null;
  return {
    source: { home_win: home / 100, draw: draw / 100, away_win: away / 100 },
    detail: {
      home_win_pct: home, draw_pct: draw, away_win_pct: away,
      top_pick: p?.top_pick ?? null,
      calibrated: true,
      note: 'model ML calibrat, antrenat fără cote de bookmaker',
    },
  };
}

/**
 * Piețe de colțuri și cartonașe din tendințele istorice.
 * Liniile vin per echipă; le combinăm pe total meci.
 */
export function trendMarkets(trends) {
  if (!trends?.eligible) return null;
  const h = trends.home_team, a = trends.away_team;
  if (!h?.corners || !a?.corners) return null;

  const totalCornersLine = (h.corners.line ?? 0) + (a.corners.line ?? 0);
  const totalCornersAvg = (h.corners.avg ?? 0) + (a.corners.avg ?? 0);
  const totalCardsLine = (h.cards?.line ?? 0) + (a.cards?.line ?? 0);
  const totalCardsAvg = (h.cards?.avg ?? 0) + (a.cards?.avg ?? 0);
  const sample = Math.min(h.corners.sample_size ?? 0, a.corners.sample_size ?? 0);

  return {
    corners: {
      line: totalCornersLine, avg: totalCornersAvg,
      side: totalCornersAvg > totalCornersLine ? 'over' : 'under',
      sample_size: sample,
    },
    cards: {
      line: totalCardsLine, avg: totalCardsAvg,
      side: totalCardsAvg > totalCardsLine ? 'over' : 'under',
      sample_size: sample,
    },
    league_coverage_pct: trends.league_coverage?.coverage_pct ?? null,
  };
}

/**
 * Construiește lista de piețe candidate din probabilitățile blendate.
 * `odds` (opțional): { '1x2': [home, draw, away], over_under: [over25, under25], btts: [yes, no] }
 */
export function buildCandidates({ probs, secondary, odds, personality, oddsFormat = 'decimal' }) {
  const candidates = [];
  const wanted = new Set(personality.policy.markets);

  const groups = [];
  if (wanted.has('1x2')) {
    groups.push({
      market: '1x2',
      selections: [
        { selection: '1', label: 'Victorie gazde', prob: probs.home_win },
        { selection: 'X', label: 'Egal', prob: probs.draw },
        { selection: '2', label: 'Victorie oaspeți', prob: probs.away_win },
      ],
    });
  }
  if (wanted.has('over_under') && Number.isFinite(secondary?.over25)) {
    groups.push({
      market: 'over_under',
      selections: [
        { selection: 'Over 2.5', label: 'Peste 2.5 goluri', prob: secondary.over25 },
        { selection: 'Under 2.5', label: 'Sub 2.5 goluri', prob: 1 - secondary.over25 },
      ],
    });
  }
  if (wanted.has('btts') && Number.isFinite(secondary?.btts_yes)) {
    groups.push({
      market: 'btts',
      selections: [
        { selection: 'BTTS Yes', label: 'Ambele marchează', prob: secondary.btts_yes },
        { selection: 'BTTS No', label: 'Nu marchează ambele', prob: 1 - secondary.btts_yes },
      ],
    });
  }

  for (const group of groups) {
    const groupOdds = odds?.[group.market];
    let fairMarket = null;
    if (Array.isArray(groupOdds) && groupOdds.length === group.selections.length) {
      try {
        fairMarket = devig(groupOdds, { format: oddsFormat, method: 'shin' });
      } catch { fairMarket = null; }
    }
    group.selections.forEach((sel, i) => {
      const entry = {
        market: group.market,
        selection: sel.selection,
        label: sel.label,
        model_prob: sel.prob,
        model_prob_pct: pct(sel.prob),
      };
      if (fairMarket) {
        const decimalOdds = fairMarket.fair_odds ? 1 / fairMarket.implied_probabilities[i] : null;
        const evaluation = evaluateBet({
          fairProb: sel.prob,
          decimalOdds,
          kellyFraction: personality.policy.kellyFraction ?? config.bot.kellyFraction,
          maxStake: config.bot.maxKellyStake,
        });
        entry.book_odds = decimalOdds;
        entry.market_fair_prob = fairMarket.fair_probabilities[i];
        entry.market_fair_prob_pct = pct(fairMarket.fair_probabilities[i]);
        entry.vig_pct = Math.round(fairMarket.vig_pct * 100) / 100;
        // Edge-ul se calculează vs probabilitatea de-vigată (fair), nu vs cota brută.
        entry.edge_pct = Math.round((sel.prob - fairMarket.fair_probabilities[i]) * 1000) / 10;
        entry.ev_pct = Math.round(evaluation.ev_pct * 10) / 10;
        entry.kelly_stake = Math.round(evaluation.kelly_stake * 10000) / 10000;
      }
      candidates.push(entry);
    });
  }
  return candidates;
}

/** Aplică politica personalității și alege pariul (sau NO BET). */
export function selectPick(candidates, personality, { hasOdds }) {
  const policy = personality.policy;
  const minEdge = policy.minEdgePct ?? config.bot.minEdgePct;
  const minConf = policy.minConfidence ?? config.bot.minConfidence;

  if (policy.requireOdds && !hasOdds) {
    return { pick: null, reason_no_bet: 'Personalitatea cere cote de piață, dar nu au fost furnizate.' };
  }

  let pool = candidates.filter((c) => c.model_prob_pct >= minConf);
  if (policy.avoidDraw) pool = pool.filter((c) => c.selection !== 'X');
  if (policy.preferUnderdog) {
    const oneX2 = candidates.filter((c) => c.market === '1x2');
    const underdog = [...oneX2].sort((a, b) => a.model_prob - b.model_prob)[0];
    const favourite = [...oneX2].sort((a, b) => b.model_prob - a.model_prob)[0];
    pool = pool.filter((c) => !(c.market === '1x2' && c.selection === favourite?.selection));
    if (underdog && !pool.includes(underdog)) pool.push(underdog);
  }
  if (hasOdds) pool = pool.filter((c) => (c.edge_pct ?? -Infinity) >= minEdge);

  if (!pool.length) {
    return {
      pick: null,
      reason_no_bet: hasOdds
        ? `Nicio selecție nu trece pragurile (edge ≥ ${minEdge}%, încredere ≥ ${minConf}%).`
        : `Nicio selecție nu trece pragul de încredere (≥ ${minConf}%).`,
    };
  }

  const rankBy = policy.rankBy ?? (hasOdds ? 'ev' : 'confidence');
  const score = (c) => (rankBy === 'edge' ? (c.edge_pct ?? -1e9)
    : rankBy === 'ev' ? (c.ev_pct ?? c.model_prob_pct)
    : c.model_prob_pct);
  pool.sort((a, b) => score(b) - score(a));
  return { pick: pool[0], alternatives: pool.slice(1, 4) };
}

/**
 * Rulează botul pe un bundle de meci.
 * @param {object} bundle rezultatul lui dataFetcher.fetchMatchBundle
 * @param {object} options { personalityId, odds, oddsFormat, simulations, seed, match }
 */
export function runBot(bundle, options = {}) {
  const {
    personalityId = config.bot.id,
    odds = null,
    oddsFormat = 'decimal',
    simulations = 10000,
    seed = 42,
    match = null,
  } = options;

  // Cotele explicite (CLI / body) au prioritate; altfel folosim cotele de piață
  // din bundle, disponibile pe cheile cu scope admin.
  const effectiveOdds = odds ?? bundle.market_odds ?? null;
  const oddsSource = odds ? 'furnizate' : (bundle.market_odds ? 'predictcamp_market_odds' : null);

  const personality = getPersonality(personalityId);
  const { sources, detail } = buildModelSources(bundle.models, { simulations, seed });

  const ml = mlSource(bundle.ml_1x2);
  if (ml) { sources.ml = ml.source; detail.ml_1x2 = ml.detail; }

  const trends = trendMarkets(bundle.corner_card_trends);
  if (trends) detail.trends = trends;

  if (!Object.keys(sources).length) {
    throw new Error(`runBot: niciun model utilizabil pentru ${bundle.slug}`);
  }

  const ensemble = blend(sources, personality.weights);
  const consensus = agreement(sources);

  const base = { home_win: ensemble.home_win, draw: ensemble.draw, away_win: ensemble.away_win };
  const adjusted = personality.adjust(base, bundle.context) ?? base;

  const secondary = {
    over25: ensemble.over25 ?? sources.monteCarlo?.over25 ?? sources.dixonColes?.over25,
    btts_yes: ensemble.btts_yes ?? sources.monteCarlo?.btts_yes ?? sources.dixonColes?.btts_yes,
  };

  const candidates = buildCandidates({ probs: adjusted, secondary, odds: effectiveOdds, personality, oddsFormat });
  const hasOdds = candidates.some((c) => Number.isFinite(c.edge_pct));
  let { pick, alternatives, reason_no_bet } = selectPick(candidates, personality, { hasOdds });

  // Fallback pe dublă șansă — damage control, nu strategie. Oprit implicit
  // (ALLOW_DOUBLE_CHANCE_FALLBACK). Nu schimbă miza și nu creează pick-uri noi:
  // doar convertește un pick 1X2 deja selectat, cu încredere ≥60%.
  const dc = toDoubleChance({
    pick,
    probs: {
      homeWinPct: pct(adjusted.home_win),
      drawPct: pct(adjusted.draw),
      awayWinPct: pct(adjusted.away_win),
    },
    odds1x2: effectiveOdds?.['1x2'],
  });
  if (dc) {
    alternatives = [pick, ...(alternatives ?? [])];
    pick = dc;
  }

  const analysis = {
    slug: bundle.slug,
    match: match ?? { home_team: bundle.models?.home_team, away_team: bundle.models?.away_team },
    bot: { id: personality.id, name: personality.name, tagline: personality.tagline },
    probabilities: {
      home_win_pct: pct(adjusted.home_win),
      draw_pct: pct(adjusted.draw),
      away_win_pct: pct(adjusted.away_win),
      over25_pct: Number.isFinite(secondary.over25) ? pct(secondary.over25) : null,
      btts_pct: Number.isFinite(secondary.btts_yes) ? pct(secondary.btts_yes) : null,
    },
    pre_adjustment: {
      home_win_pct: pct(base.home_win), draw_pct: pct(base.draw), away_win_pct: pct(base.away_win),
    },
    models_used: ensemble.models_used,
    model_weights: ensemble.weights,
    models_detail: detail,
    models_consensus: consensus,
    trends: trends ?? null,
    odds_source: oddsSource,
    odds_meta: oddsSource === 'predictcamp_market_odds' ? bundle.market_odds_meta : null,
    candidates,
    alternatives: alternatives ?? [],
    partial_sources: bundle.partial ?? null,
    computed_at: new Date().toISOString(),
  };

  const reasoning = buildReasoning({ analysis, pick, personality, context: bundle.context, reasonNoBet: reason_no_bet });

  return {
    ...analysis,
    prediction: pick ? `${pick.label} (${pick.selection})` : 'NO BET',
    selection: pick?.selection ?? null,
    market: pick?.market ?? null,
    confidence: pick ? pick.model_prob_pct : null,
    edge_pct: pick?.edge_pct ?? null,
    ev_percent: pick?.ev_pct ?? null,
    kelly_stake: pick?.kelly_stake ?? null,
    no_bet_reason: pick ? null : reason_no_bet,
    // Avertismentul însoțește pick-ul până în UI: un ROI de −1.4% nu e „aproape profit".
    warning: pick?.warning ?? null,
    converted_from: pick?.converted_from ?? null,
    reasoning,
  };
}

export default { runBot, buildModelSources, buildCandidates, selectPick, mlSource, trendMarkets };
