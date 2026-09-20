#!/usr/bin/env node
/**
 * Runner zilnic: generează predicții pentru meciurile din fereastra 2–48h
 * și le persistă în data/predictions/YYYY-MM-DD.jsonl.
 *
 * Cron pe VPS (06:00):  0 6 * * *  cd /var/www/predictbot && node src/cron/botPredictCrawler.js
 * sau pm2: pm2 start ecosystem.config.cjs --only predictbot-crawler
 */
import { predictUpcoming } from '../index.js';
import { personalities } from '../bot/personalities.js';
import config from '../config.js';
import log from '../lib/log.js';

const BOTS = (process.env.CRAWLER_BOTS || config.bot.id)
  .split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  const started = Date.now();
  const bots = BOTS.filter((id) => {
    if (personalities[id]) return true;
    log.warn('crawler_unknown_bot', { botId: id });
    return false;
  });
  if (!bots.length) throw new Error('niciun bot valid în CRAWLER_BOTS');

  // Un singur fetch per meci, refolosit de toate personalitățile (rate limit).
  const results = await predictUpcoming({ personalityIds: bots, persist: true });

  const summary = bots.map((botId) => {
    const mine = results.filter((r) => r.bot?.id === botId);
    const ok = mine.filter((r) => !r.error);
    return {
      bot: botId,
      matches: mine.length,
      predictions: ok.filter((r) => r.selection).length,
      no_bets: ok.filter((r) => !r.selection).length,
      errors: mine.length - ok.length,
    };
  });
  const matchErrors = results.filter((r) => r.error && !r.bot).length;

  log.info('crawler_done', {
    duration_ms: Date.now() - started,
    window_hours: config.cron.hoursAhead,
    match_errors: matchErrors,
    summary,
  });
  console.log(JSON.stringify({ ok: true, match_errors: matchErrors, summary }, null, 2));
}

main().catch((err) => {
  log.error('crawler_failed', { error: err.message, stack: err.stack });
  process.exitCode = 1;
});
