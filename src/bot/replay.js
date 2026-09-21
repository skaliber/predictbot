/**
 * Replay istoric: reconstruiește, pentru un meci din trecut, exact ce ar fi
 * știut botul la kickoff — și nimic din ce s-a întâmplat după.
 *
 * Ce se poate reconstrui fidel:
 *   - Dixon-Coles, Poisson, Elo, Monte Carlo, ensemble, consens  (refit pe trecut)
 *   - forma ultimelor 5 meciuri, H2H                             (din rezultate anterioare)
 *   - eșantionul per echipă                                      (numărare pe trecut)
 *   - cotele de piață, de-vig, edge, Kelly                       (recorded_before_kickoff)
 *
 * Ce NU se poate, și de ce e exclus din replay:
 *   - `granular-stats` se calculează ACUM, deci pentru un meci vechi ar include
 *     meciuri de după el — leakage. Regulile bazate pe el nu se validează aici.
 *   - flag-urile de fallback ale PredictCamp (`/models` dă 422 după meci). Se
 *     aproximează cu eșantionul propriu, care e semnalul de dedesubt.
 */
import { fitDixonColes, lambdasFromFit, predictDixonColes } from '../models/dixonColes.js';
import { predictPoisson } from '../models/poisson.js';
import { buildRatings, predictElo } from '../models/elo.js';
import { simulate } from '../models/monteCarlo.js';
import { blend, agreement } from '../models/ensemble.js';
import { devig } from '../betting/odds.js';
import { evaluateBet } from '../betting/kelly.js';
import { getPersonality } from './personalities.js';
import { buildCandidates, selectPick } from './botLogic.js';
import { formSummary, formVeto, consensusVsMarket, tierFor, safetyScore, flag, THRESHOLDS } from './screening.js';

const OUTCOME = (h, a) => (h > a ? '1' : h === a ? 'X' : '2');
const SIDE_OF = { '1': 'home', X: 'draw', '2': 'away' };

/** Ultimele `n` rezultate ale unei echipe, din meciuri strict anterioare. */
export function formBefore(history, team, n = 5) {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < n; i--) {
    const m = history[i];
    if (m.home !== team && m.away !== team) continue;
    const isHome = m.home === team;
    const gf = isHome ? m.homeGoals : m.awayGoals;
    const ga = isHome ? m.awayGoals : m.homeGoals;
    out.push({ result: gf > ga ? 'W' : gf === ga ? 'D' : 'L', goals_for: gf, goals_against: ga, date: m.date });
  }
  return out;
}

/** Câte meciuri are echipa în fereastra de antrenare. */
export function sampleFor(history, team) {
  return history.reduce((n, m) => n + (m.home === team || m.away === team ? 1 : 0), 0);
}

/**
 * Un singur meci de test. `history` = meciurile strict anterioare, cronologic.
 * Întoarce null dacă modelul nu poate produce nimic (echipă nevăzută).
 */
/**
 * Sursele de model pentru un meci, calculate din trecut. Partea scumpă
 * (refit Dixon-Coles + Monte Carlo) se face o singură dată, ca optimizarea de
 * ponderi să poată evalua mii de combinații fără să reantreneze nimic.
 */
export function replaySources({ history, target, simulations = 5000, seed = 1, xi = 0.0065 }) {
  let fit;
  try {
    fit = fitDixonColes(history, { referenceDate: target.date, xi });
    lambdasFromFit(fit, target.home, target.away);
  } catch { return null; }

  const dc = predictDixonColes({ fit, home: target.home, away: target.away });
  const mc = simulate(dc.matrix, { simulations, seed });

  const sources = { dixonColes: dc, monteCarlo: mc };
  // Poisson „naiv": medii de goluri marcate/primite, fără forță comună.
  const avg = averages(history, target.home, target.away);
  if (avg) sources.poisson = predictPoisson({ lambdaHome: avg.lambdaHome, lambdaAway: avg.lambdaAway });

  const ratings = buildRatings(history);
  if (Number.isFinite(ratings[target.home]) && Number.isFinite(ratings[target.away])) {
    sources.elo = predictElo({ ratingHome: ratings[target.home], ratingAway: ratings[target.away] });
  }
  return sources;
}

export function replayMatch({ history, target, personalityId = 'ai-analyst', simulations = 5000, seed = 1, xi = 0.0065, sources: precomputed }) {
  const sources = precomputed ?? replaySources({ history, target, simulations, seed, xi });
  if (!sources) return null;

  const personality = getPersonality(personalityId);
  const ensemble = blend(sources, personality.weights);
  const consensus = agreement(sources);

  const context = target.context ?? {
    home_form: formBefore(history, target.home),
    away_form: formBefore(history, target.away),
  };
  const base = { home_win: ensemble.home_win, draw: ensemble.draw, away_win: ensemble.away_win };
  const probs = personality.adjust(base, context) ?? base;

  const trio = ['1', 'X', '2'];
  const arr = [probs.home_win, probs.draw, probs.away_win];
  const marketFair = target.odds ? devig(target.odds, { method: 'shin' }).fair_probabilities : null;

  // Selecția trece prin ACELAȘI cod ca producția, ca să fie comparabilă:
  // politica personalității (praguri, evitarea egalului, contrarian) contează.
  // Doar 1X2 — piețele de goluri au nevoie de granular, care nu e replayabil.
  const oneX2Personality = { ...personality, policy: { ...personality.policy, markets: ['1x2'] } };
  const candidates = buildCandidates({
    probs, secondary: {}, odds: target.odds ? { '1x2': target.odds } : null,
    personality: oneX2Personality,
  });
  const { pick } = selectPick(candidates, oneX2Personality, { hasOdds: Boolean(target.odds) });
  if (!pick) {
    return {
      slug: target.slug, date: target.date, league: target.league,
      selection: null, no_bet: true, tier: 'NO_BET', probs: arr,
      outcome: OUTCOME(target.homeGoals, target.awayGoals), hit: false, flags: [],
    };
  }

  const selection = pick.selection;
  const probPct = pick.model_prob_pct;
  const pickedSide = SIDE_OF[selection];
  const odds = pick.book_odds ?? null;
  let edgePct = pick.edge_pct ?? null;
  let evPct = pick.ev_pct ?? null;
  let kelly = pick.kelly_stake ?? null;

  const minSample = target.minSample ?? Math.min(sampleFor(history, target.home), sampleFor(history, target.away));
  const flags = [
    ...formVeto(context, pickedSide),
    ...consensusVsMarket(consensus, marketFair),
  ];
  if (minSample < THRESHOLDS.SMALL_SAMPLE) {
    flags.push(flag('SMALL_SAMPLE', 'downgrade', `Eșantion mic (${minSample} meciuri).`, { sample: minSample }));
  }
  if (!target.odds) flags.push(flag('NO_ODDS', 'note', 'Fără cote pre-kickoff.'));

  const tier = tierFor({ flags, probPct, edgePct });
  const score = safetyScore({ probPct, edgePct, consensus, flags });
  const outcome = OUTCOME(target.homeGoals, target.awayGoals);

  return {
    slug: target.slug,
    date: target.date,
    selection,
    prob_pct: probPct,
    probs: arr,
    odds,
    edge_pct: edgePct,
    ev_pct: evPct,
    kelly_stake: kelly,
    market_fair: marketFair,
    tier,
    score,
    flags,
    consensus,
    sample: minSample,
    outcome,
    hit: selection === outcome,
    form: { home: formSummary(context.home_form), away: formSummary(context.away_form) },
  };
}

/** λ „Poisson naiv" din mediile echipelor pe fereastra de antrenare. */
function averages(history, home, away) {
  const stat = (team) => {
    let gf = 0, ga = 0, n = 0;
    for (const m of history) {
      if (m.home === team) { gf += m.homeGoals; ga += m.awayGoals; n++; }
      else if (m.away === team) { gf += m.awayGoals; ga += m.homeGoals; n++; }
    }
    return n ? { gf: gf / n, ga: ga / n, n } : null;
  };
  const h = stat(home), a = stat(away);
  if (!h || !a) return null;
  // Media geometrică simplă între atacul unuia și apărarea celuilalt.
  return {
    lambdaHome: Math.max(0.15, Math.min(6, (h.gf + a.ga) / 2)),
    lambdaAway: Math.max(0.15, Math.min(6, (a.gf + h.ga) / 2)),
  };
}

export default { replayMatch, replaySources, formBefore, sampleFor };
