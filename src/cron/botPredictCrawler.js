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
  const summary = [];
  for (const botId of BOTS) {
    if (!personalities[botId]) { log.warn('crawler_unknown_bot', { botId }); continue; }
    const results = await predictUpcoming({ personalityId: botId, persist: true });
    const ok = results.filter((r) => !r.error);
    summary.push({
      bot: botId,
      matches: results.length,
      predictions: ok.filter((r) => r.selection).length,
      no_bets: ok.filter((r) => !r.selection).length,
      errors: results.length - ok.length,
    });
  }
  log.info('crawler_done', { duration_ms: Date.now() - started, window_hours: config.cron.hoursAhead, summary });
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main().catch((err) => {
  log.error('crawler_failed', { error: err.message, stack: err.stack });
  process.exitCode = 1;
});
