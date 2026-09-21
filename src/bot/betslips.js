/**
 * Construirea biletelor: analizează un slate de meciuri, aplică regulile de
 * screening, și propune bilete de 3 legs.
 */
import { fetchMatchBundle, getUpcomingMatches, getGranularStats } from '../dataFetcher.js';
import { runBot } from './botLogic.js';
import { devig } from '../betting/odds.js';
import log from '../lib/log.js';
import {
  classifyFallback, formSummary, formVeto, competitionFilter,
  consensusVsMarket, granularMarkets, tierFor, safetyScore, flag,
} from './screening.js';

const SIDE_OF = { '1': 'home', X: 'draw', '2': 'away' };

/** Miza implicită: două bilete separate de 50 RON, nu unul de 100 (risc diversificat). */
export const STAKE = { perSlip: 50, slips: 2, legsPerSlip: 3, bankrollCap: 300 };

/** Analizează un meci: modele + screening. Întoarce candidatul sau motivul excluderii. */
export async function analyseMatch(match, { personalityId = 'ai-analyst', simulations = 10000 } = {}) {
  const compFlags = competitionFilter(match);
  if (compFlags.some((f) => f.severity === 'exclude')) {
    return { slug: match.slug, match, excluded: true, flags: compFlags };
  }

  if (!match.ensemble_prediction) {
    return {
      slug: match.slug, match, excluded: true,
      flags: [flag('NO_ENSEMBLE', 'exclude', 'ensemble_prediction lipsește — meci fără semnal utilizabil.')],
    };
  }

  const bundle = await fetchMatchBundle(match.slug);
  // granular-stats e obligatoriu pentru piețele alternative; nu blochează dacă lipsește.
  let granular = null;
  try { granular = await getGranularStats(match.slug); }
  catch (err) { log.debug('granular_missing', { slug: match.slug, error: err.message }); }

  const analysis = runBot(bundle, { personalityId, simulations, match });
  const pickedSide = SIDE_OF[analysis.selection] ?? null;

  const marketFair = bundle.market_odds?.['1x2']
    ? devig(bundle.market_odds['1x2'], { method: 'shin' }).fair_probabilities
    : null;

  const flags = [
    ...compFlags,
    ...classifyFallback(bundle.models, { pickedSide }),
    ...(analysis.market === '1x2' ? formVeto(bundle.context, pickedSide) : []),
    ...consensusVsMarket(analysis.models_consensus, marketFair),
  ];
  if (!bundle.market_odds) {
    flags.push(flag('NO_ODDS', 'note', 'Fără cote de piață pentru acest meci — edge-ul nu poate fi calculat.'));
  }

  const altMarkets = granularMarkets(granular);
  // Alinierea granular-stats cu pick-ul ales, când pick-ul e pe o piață de goluri.
  const aligned = altMarkets.find((m) => m.selection === analysis.selection);
  if (analysis.market && analysis.market !== '1x2') {
    if (!altMarkets.length) {
      flags.push(flag('NO_GRANULAR', 'downgrade',
        'Piață alternativă fără confirmare din granular-stats — probabilitățile brute de model nu sunt suficiente.'));
    } else if (!aligned) {
      const contra = altMarkets.find((m) => m.market === analysis.market);
      if (contra) {
        flags.push(flag('GRANULAR_CONTRADICTS', 'downgrade',
          `granular-stats indică „${contra.selection}" (${contra.granular_pct}% vs baseline ${contra.league_baseline_pct}%), ` +
          `nu „${analysis.selection}".`, contra));
      }
    }
  }

  const probPct = analysis.confidence;
  const edgePct = analysis.edge_pct;
  const tier = tierFor({ flags, probPct: probPct ?? 0, edgePct });
  const score = safetyScore({
    probPct, edgePct, consensus: analysis.models_consensus, flags,
    granularDelta: aligned?.delta_vs_baseline,
  });

  return {
    slug: match.slug,
    match: {
      home: match.home_team, away: match.away_team,
      league: match.league_name, league_code: match.league_code,
      kickoff: match.match_date,
    },
    excluded: tier === 'EXCLUDED',
    tier,
    score,
    pick: analysis.selection ? {
      market: analysis.market,
      selection: analysis.selection,
      label: analysis.pick_label ?? analysis.prediction,
      prob_pct: probPct,
      odds: analysis.candidates?.find((c) => c.selection === analysis.selection)?.book_odds ?? null,
      edge_pct: edgePct,
      ev_pct: analysis.ev_percent,
      kelly_stake: analysis.kelly_stake,
    } : null,
    no_bet_reason: analysis.no_bet_reason ?? null,
    support: {
      probabilities: analysis.probabilities,
      consensus: analysis.models_consensus,
      models_used: analysis.models_used,
      dixon_coles: analysis.models_detail?.dixon_coles ?? null,
      monte_carlo: analysis.models_detail?.monte_carlo ?? null,
      form: {
        home: formSummary(bundle.context?.home_form),
        away: formSummary(bundle.context?.away_form),
      },
      h2h: bundle.context?.h2h ?? null,
      granular_markets: altMarkets,
      granular_aligned: aligned ?? null,
      trends: analysis.trends ?? null,
      odds_source: analysis.odds_source,
    },
    flags,
    reasoning: analysis.reasoning,
  };
}

/** Analizează tot slate-ul. */
export async function analyseSlate({ hoursAhead = 48, hoursMin = 2, league, limit = 60, personalityId } = {}) {
  const matches = await getUpcomingMatches({ hoursAhead, hoursMin, league, limit });
  const results = [];
  for (const m of matches) {
    try {
      results.push(await analyseMatch(m, { personalityId }));
    } catch (err) {
      log.warn('match_analysis_failed', { slug: m.slug, error: err.message, code: err.code });
      results.push({
        slug: m.slug,
        match: { home: m.home_team, away: m.away_team, league: m.league_name, kickoff: m.match_date },
        excluded: true, tier: 'EXCLUDED', score: 0,
        flags: [flag('ANALYSIS_FAILED', 'exclude', err.message, { code: err.code })],
      });
    }
  }
  return results;
}

/**
 * Construiește biletele din candidații eligibili.
 * Preferă două bilete separate de 50 RON — structural mai sigur decât unul de 100.
 * Nu forțează un bilet incomplet doar ca să ajungă la un număr.
 */
export function buildSlips(candidates, { legsPerSlip = STAKE.legsPerSlip, maxSlips = STAKE.slips, stake = STAKE.perSlip, minTier = 'MODERATE' } = {}) {
  const order = { SAFE: 0, MODERATE: 1, RISKY: 2 };
  const eligible = candidates
    .filter((c) => c.pick && !c.excluded && order[c.tier] <= order[minTier])
    .sort((a, b) => b.score - a.score);

  // Un singur leg per meci — două piețe pe același meci sunt corelate.
  const seen = new Set();
  const pool = eligible.filter((c) => (seen.has(c.slug) ? false : seen.add(c.slug)));

  const slips = [];
  for (let i = 0; i + legsPerSlip <= pool.length && slips.length < maxSlips; i += legsPerSlip) {
    const legs = pool.slice(i, i + legsPerSlip);
    const combinedProb = legs.reduce((p, l) => p * (l.pick.prob_pct / 100), 1);
    const withOdds = legs.filter((l) => Number.isFinite(l.pick.odds));
    // Rotunjim cota o singură dată, apoi calculăm returul din valoarea rotunjită:
    // altfel „cotă × miză" afișate pe bilet nu dau returul afișat.
    const combinedOdds = withOdds.length === legs.length
      ? Math.round(legs.reduce((o, l) => o * l.pick.odds, 1) * 100) / 100
      : null;
    slips.push({
      id: slips.length + 1,
      stake_ron: stake,
      legs,
      combined_prob_pct: Math.round(combinedProb * 1000) / 10,
      combined_odds: combinedOdds,
      potential_return_ron: combinedOdds ? Math.round(combinedOdds * stake * 100) / 100 : null,
      all_legs_have_odds: withOdds.length === legs.length,
    });
  }

  const leftover = pool.length - slips.length * legsPerSlip;
  return {
    slips,
    unused_candidates: leftover,
    incomplete: slips.length < maxSlips
      ? `Doar ${pool.length} candidați eligibili — ${slips.length} bilet(e) complet(e) din ${maxSlips} cerute. Nu forțez leguri slabe.`
      : null,
  };
}

export default { analyseMatch, analyseSlate, buildSlips, STAKE };
