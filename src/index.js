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
 * @param {object} opts { personalityId, odds, oddsFormat, simulations, seed, persist, bundle }
 */
export async function predictMatch(slug, opts = {}) {
  const started = Date.now();
  const bundle = opts.bundle ?? await fetchMatchBundle(slug);
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

/**
 * Rulează una sau mai multe personalități pe același meci, cu UN SINGUR fetch.
 *
 * Esențial pentru rate limit: un bundle costă până la 5 cereri, iar API-ul
 * permite 120/minut. Refetch-ul per personalitate înmulțea costul cu 7 și
 * epuiza fereastra după ~3 meciuri.
 */
export async function predictMatchForBots(slug, { personalityIds, match, persist = false, ...opts } = {}) {
  const bundle = await fetchMatchBundle(slug);
  const results = [];
  for (const personalityId of personalityIds) {
    try {
      results.push(await predictMatch(slug, { ...opts, bundle, match, persist, personalityId }));
    } catch (err) {
      log.warn('bot_failed', { slug, personalityId, error: err.message });
      results.push({ slug, bot: { id: personalityId }, error: err.message, code: err.code });
    }
  }
  return results;
}

/**
 * Rulează botul/boții pe toate meciurile din fereastra următoare.
 * @param {object} opts { personalityIds | personalityId, hoursAhead, hoursMin, league, persist, limit }
 */
export async function predictUpcoming({
  hoursAhead, hoursMin, league, personalityId, personalityIds, persist = true, limit,
} = {}) {
  const bots = personalityIds ?? [personalityId ?? config.bot.id];
  const matches = await getUpcomingMatches({ hoursAhead, hoursMin, league, limit });
  const results = [];
  for (const match of matches) {
    try {
      results.push(...await predictMatchForBots(match.slug, { personalityIds: bots, persist, match }));
    } catch (err) {
      log.warn('match_skipped', { slug: match.slug, error: err.message, code: err.code });
      results.push({ slug: match.slug, error: err.message, code: err.code });
    }
  }
  return results;
}

export { predictMatchForBots as predictForBots, runBot, fetchMatchBundle, listMatches, getMatch, getUpcomingMatches, personalities, getPersonality, config };
export default { predictMatch, predictMatchForBots, predictUpcoming, personalities };
