/**
 * API-ul public al pachetului. Orchestrare: fetch bundle → runBot → (opțional) salvare.
 */
import { fetchMatchBundle, getUpcomingMatches, listMatches, getMatch } from './dataFetcher.js';
import { runBot } from './bot/botLogic.js';
import { personalities, getPersonality } from './bot/personalities.js';
import { savePrediction } from './lib/store.js';
import log from './lib/log.js';
import config from './config.js';

/**
 * Generează predicția pentru un meci.
 * @param {string} slug
 * @param {object} opts { personalityId, odds, oddsFormat, simulations, seed, persist }
 */
export async function predictMatch(slug, opts = {}) {
  const started = Date.now();
  const bundle = await fetchMatchBundle(slug);
  const result = runBot(bundle, { ...opts, match: opts.match });
  result.duration_ms = Date.now() - started;
  if (opts.persist) {
    result.stored_at = await savePrediction(result);
  }
  log.info('prediction', {
    slug, bot: result.bot.id, prediction: result.prediction,
    confidence: result.confidence, edge_pct: result.edge_pct,
  });
  return result;
}

/** Rulează botul pe toate meciurile din fereastra următoare. */
export async function predictUpcoming({ hoursAhead, hoursMin, league, personalityId, persist = true, limit } = {}) {
  const matches = await getUpcomingMatches({ hoursAhead, hoursMin, league, limit });
  const results = [];
  for (const match of matches) {
    try {
      const r = await predictMatch(match.slug, { personalityId, persist, match });
      results.push(r);
    } catch (err) {
      log.warn('prediction_skipped', { slug: match.slug, error: err.message, code: err.code });
      results.push({ slug: match.slug, error: err.message, code: err.code });
    }
  }
  return results;
}

export { runBot, fetchMatchBundle, listMatches, getMatch, getUpcomingMatches, personalities, getPersonality, config };
export default { predictMatch, predictUpcoming, personalities };
