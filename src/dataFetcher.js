/**
 * Acces la date: PredictCamp public API (v1, cu X-Api-Key) + football-data.org.
 *
 * Endpoint-uri PredictCamp folosite:
 *   GET /matches                          — listă cu consensus + ensemble
 *   GET /matches/{slug}                   — meci
 *   GET /matches/{slug}/models            — Poisson, Dixon-Coles, Elo, Glicko2, ensemble
 *   GET /matches/{slug}/context           — H2H, formă, statistici sezon
 *   GET /matches/{slug}/bot-predictions   — predicțiile boților + consensus
 *   GET /matches/{slug}/ml-1x2            — probabilități ML calibrate
 *   GET /bots                             — catalogul de boți
 */
import config from './config.js';
import log from './lib/log.js';

export class ApiError extends Error {
  constructor(message, { status, code, url } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.url = url;
  }
}

async function request(path, { base, query, headers = {}, retries = config.api.retries } = {}) {
  const baseUrl = base ?? config.api.baseUrl;
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.api.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-Locale': config.api.locale,
          ...(config.api.apiKey ? { 'X-Api-Key': config.api.apiKey } : {}),
          ...headers,
        },
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new ApiError(body?.error || `HTTP ${res.status}`, {
          status: res.status, code: body?.code, url: url.toString(),
        });
        // 4xx nu se reîncearcă (cheie invalidă, slug inexistent, models not available).
        if (res.status < 500) throw err;
        lastErr = err;
      } else {
        return body;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) throw err;
      lastErr = err;
      log.warn('api_retry', { url: url.toString(), attempt, error: err.message });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastErr ?? new ApiError('cerere eșuată', { url: url.toString() });
}

/* ---------- PredictCamp ---------- */

export async function listMatches({ status, league, from, to, page = 1, limit = 50 } = {}) {
  const body = await request('/matches', { query: { status, league, from, to, page, limit } });
  return body?.matches ?? body?.data ?? [];
}

export async function getMatch(slug) {
  return request(`/matches/${encodeURIComponent(slug)}`);
}

export async function getMatchModels(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/models`);
}

export async function getMatchContext(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/context`);
}

export async function getBotPredictions(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/bot-predictions`);
}

export async function getMl1x2(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/ml-1x2`);
}

export async function listBots() {
  return request('/bots');
}

/** `from`/`to` din API acceptă doar YYYY-MM-DD, nu ISO 8601 complet. */
export function toApiDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError(`dată invalidă: ${value}`);
  return d.toISOString().slice(0, 10);
}

/**
 * Meciurile care intră în fereastra de predicție (implicit 2–48h înainte de start).
 * Filtrul de zi merge la API; fereastra exactă în ore se aplică local, fiindcă
 * API-ul are granularitate de zi.
 */
export async function getUpcomingMatches({ hoursAhead = config.cron.hoursAhead, hoursMin = config.cron.hoursMin, league, limit = 100 } = {}) {
  const now = Date.now();
  const from = toApiDate(now + hoursMin * 3600_000);
  const to = toApiDate(now + hoursAhead * 3600_000);
  const matches = await listMatches({ status: 'TIMED', league, from, to, limit });
  return matches.filter((m) => {
    const t = new Date(m.match_date).getTime();
    return t >= now + hoursMin * 3600_000 && t <= now + hoursAhead * 3600_000;
  });
}

/**
 * Pachetul complet pentru un meci. Sursele opționale (ml-1x2, bot-predictions)
 * nu blochează predicția dacă lipsesc — se raportează în `partial`.
 */
export async function fetchMatchBundle(slug) {
  const [models, context, bots, ml] = await Promise.allSettled([
    getMatchModels(slug),
    getMatchContext(slug),
    getBotPredictions(slug),
    getMl1x2(slug),
  ]);
  const unwrap = (r) => (r.status === 'fulfilled' ? r.value : null);
  const failed = [];
  const named = { models, context, bots, ml };
  for (const [name, r] of Object.entries(named)) {
    if (r.status === 'rejected') failed.push({ source: name, error: r.reason?.message, code: r.reason?.code });
  }
  if (models.status === 'rejected') {
    throw new ApiError(`models indisponibile pentru ${slug}: ${models.reason?.message}`, {
      code: models.reason?.code, status: models.reason?.status,
    });
  }
  return {
    slug,
    models: unwrap(models),
    context: unwrap(context),
    bot_predictions: unwrap(bots),
    ml_1x2: unwrap(ml),
    partial: failed.length ? failed : null,
  };
}

/* ---------- football-data.org (opțional) ---------- */

export async function getFootballDataFixtures({ competition, dateFrom, dateTo } = {}) {
  if (!config.footballData.token) {
    throw new ApiError('FOOTBALL_DATA_TOKEN lipsește — sursa football-data.org e dezactivată');
  }
  const path = competition ? `/competitions/${competition}/matches` : '/matches';
  return request(path, {
    base: config.footballData.baseUrl,
    query: { dateFrom, dateTo },
    headers: { 'X-Auth-Token': config.footballData.token },
  });
}

export default {
  toApiDate, listMatches, getMatch, getMatchModels, getMatchContext, getBotPredictions,
  getMl1x2, listBots, getUpcomingMatches, fetchMatchBundle, getFootballDataFixtures, ApiError,
};
