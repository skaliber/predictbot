/**
 * HTTP API al botului. Rulează alături de PredictCamp pe același VPS.
 *
 *   GET  /health
 *   GET  /api/bots                                  — catalogul de personalități
 *   POST /api/bots/:botId/predict                   — { matchSlug, odds?, oddsFormat?, persist? }
 *   GET  /api/bots/:botId/predict/:slug             — variantă GET, fără cote
 *   GET  /api/bots/:botId/history                   — predicții salvate + acuratețe
 */
import express from 'express';
import { predictMatch, personalities } from './index.js';
import { loadPredictions } from './lib/store.js';
import { summarize } from './lib/accuracy.js';
import config from './config.js';
import log from './lib/log.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'predictbot', bots: Object.keys(personalities) }));

  app.get('/api/bots', (_req, res) => {
    res.json({
      bots: Object.values(personalities).map((p) => ({
        id: p.id, name: p.name, tagline: p.tagline, policy: p.policy, weights: p.weights,
      })),
    });
  });

  const handle = async (req, res, body) => {
    const botId = req.params.botId;
    if (!personalities[botId]) {
      return res.status(404).json({ error: `bot necunoscut: ${botId}`, code: 'UNKNOWN_BOT' });
    }
    const slug = body.matchSlug ?? req.params.slug;
    if (!slug) return res.status(400).json({ error: 'matchSlug lipsește', code: 'MISSING_SLUG' });
    try {
      const result = await predictMatch(slug, {
        personalityId: botId,
        odds: body.odds ?? null,
        oddsFormat: body.oddsFormat ?? 'decimal',
        simulations: body.simulations ?? 10000,
        persist: body.persist ?? false,
      });
      res.json(result);
    } catch (err) {
      const status = err.status === 422 ? 422 : err.status === 404 ? 404 : 502;
      log.error('predict_failed', { slug, botId, error: err.message, code: err.code });
      res.status(status).json({ error: err.message, code: err.code ?? 'PREDICT_FAILED' });
    }
  };

  app.post('/api/bots/:botId/predict', (req, res) => handle(req, res, req.body ?? {}));
  app.get('/api/bots/:botId/predict/:slug', (req, res) => handle(req, res, {}));

  app.get('/api/bots/:botId/history', async (req, res) => {
    const all = await loadPredictions({ since: req.query.since });
    const mine = all.filter((p) => p.bot?.id === req.params.botId);
    res.json({ bot: req.params.botId, count: mine.length, accuracy: summarize(mine), predictions: mine.slice(-200) });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(config.server.port, () => log.info('server_listening', { port: config.server.port }));
}

export default createApp;
