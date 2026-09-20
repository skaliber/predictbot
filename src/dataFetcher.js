/**
 * Acces la date: PredictCamp public API (v1, cu X-Api-Key) + football-data.org.
 *
 * Endpoint-uri PredictCamp folosite:
 *   GET /matches                          — listă cu consensus + ensemble
 *   GET /matches/{slug}                   — meci
 *   GET /matches/{slug}/models            — Poisson, Dixon-Coles, Elo, Glicko2, ensemble
 *   GET /matches/{slug}/context           — H2H, formă, statistici sezon
 *   GET /matches/{slug}/bots              — predicțiile boților PredictCamp
 *   GET /matches/{slug}/ml-1x2            — probabilități ML calibrate
 *   GET /bots                             — catalogul de boți
 */
import config from './config.js';
import log from './lib/log.js';
import { RateLimiter, sleep } from './lib/rateLimiter.js';

/** Un singur limiter pentru tot procesul — API-ul numără per cheie, nu per apel. */
export const limiter = new RateLimiter({
  maxRequests: config.api.maxRequestsPerMinute,
  windowMs: 60_000,
});

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
    await limiter.acquire();
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
        // 429: serverul ne spune cât să așteptăm — blocăm tot procesul și reîncercăm.
        if (res.status === 429) {
          const resetSec = Number(res.headers.get('ratelimit-reset') ?? res.headers.get('retry-after') ?? 60);
          const waitMs = (Number.isFinite(resetSec) ? resetSec : 60) * 1000 + 500;
          limiter.blockFor(waitMs);
          log.warn('api_rate_limited', { url: url.toString(), wait_ms: waitMs, attempt });
          lastErr = err;
          if (attempt < retries) { await sleep(waitMs); continue; }
          throw err;
        }
        // Restul de 4xx nu se reîncearcă (cheie invalidă, slug inexistent, 404).
        if (res.status < 500) throw err;
        lastErr = err;
      } else {
        return body;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status < 500 && err.status !== 429) throw err;
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

/** Limita maximă acceptată de API pentru o pagină. */
export const MAX_PAGE_LIMIT = 50;

/** O singură pagină. Întoarce și metadatele de paginare. */
export async function listMatchesPage({ status, league, from, to, page = 1, limit = MAX_PAGE_LIMIT } = {}) {
  if (limit > MAX_PAGE_LIMIT) throw new RangeError(`limit maxim ${MAX_PAGE_LIMIT}, primit ${limit}`);
  const body = await request('/matches', { query: { status, league, from, to, page, limit } });
  return {
    matches: body?.matches ?? body?.data ?? [],
    pagination: body?.pagination ?? null,
  };
}

/**
 * Listă de meciuri, cu paginare automată — API-ul refuză limit > 50, deci un
 * `limit` mai mare se traduce în mai multe cereri.
 */
export async function listMatches({ status, league, from, to, page, limit = MAX_PAGE_LIMIT } = {}) {
  if (page !== undefined) {
    return (await listMatchesPage({ status, league, from, to, page, limit: Math.min(limit, MAX_PAGE_LIMIT) })).matches;
  }
  const out = [];
  for (let p = 1; out.length < limit; p++) {
    const pageSize = Math.min(MAX_PAGE_LIMIT, limit - out.length);
    const { matches, pagination } = await listMatchesPage({ status, league, from, to, page: p, limit: pageSize });
    out.push(...matches);
    if (!matches.length) break;
    if (pagination && p >= pagination.pages) break;
    if (!pagination && matches.length < pageSize) break;
  }
  return out.slice(0, limit);
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

/** Calea corectă e /bots — /bot-predictions nu există în spec (întorcea 500). */
export async function getBotPredictions(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/bots`);
}

export async function getMl1x2(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/ml-1x2`);
}

export async function listBots() {
  return request('/bots');
}

/** Statistici granulare (stil footystats): Over/Under, BTTS, colțuri, cartonașe. */
export async function getGranularStats(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/granular-stats`);
}

/** Tendințe istorice de colțuri / cartonașe / șuturi, cu linii și încredere. */
export async function getCornerCardTrends(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/corner-card-trends`);
}

/** Statistici de meci (goluri, penalty shootout). */
export async function getMatchStats(slug) {
  return request(`/matches/${encodeURIComponent(slug)}/stats`);
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

/** Sursele opționale ale bundle-ului și funcțiile care le aduc. */
const OPTIONAL_SOURCES = {
  context: getMatchContext,
  bot_predictions: getBotPredictions,
  ml_1x2: getMl1x2,
  granular_stats: getGranularStats,
  corner_card_trends: getCornerCardTrends,
};

export const DEFAULT_INCLUDE = ['context', 'bot_predictions', 'ml_1x2', 'corner_card_trends'];

/**
 * Pachetul complet pentru un meci. `models` e obligatoriu; restul surselor nu
 * blochează predicția dacă lipsesc — se raportează în `partial`.
 *
 * ml_1x2 dă 404 în afara celor 5 ligi mari (sau când modelul e oprit), iar
 * corner_card_trends poate întoarce `eligible: false` — ambele sunt normale.
 */
export async function fetchMatchBundle(slug, { include = DEFAULT_INCLUDE } = {}) {
  const wanted = include.filter((name) => OPTIONAL_SOURCES[name]);
  const [modelsResult, ...rest] = await Promise.allSettled([
    getMatchModels(slug),
    ...wanted.map((name) => OPTIONAL_SOURCES[name](slug)),
  ]);

  if (modelsResult.status === 'rejected') {
    const reason = modelsResult.reason;
    throw new ApiError(`models indisponibile pentru ${slug}: ${reason?.message}`, {
      code: reason?.code, status: reason?.status,
    });
  }

  const bundle = { slug, models: modelsResult.value };
  const failed = [];
  wanted.forEach((name, i) => {
    const r = rest[i];
    bundle[name] = r.status === 'fulfilled' ? r.value : null;
    if (r.status === 'rejected') {
      failed.push({ source: name, error: r.reason?.message, code: r.reason?.code });
    }
  });
  bundle.partial = failed.length ? failed : null;
  bundle.fetched_at = new Date().toISOString();
  return bundle;
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
  toApiDate, listMatches, listMatchesPage, MAX_PAGE_LIMIT, getMatch,
  getGranularStats, getCornerCardTrends, getMatchStats, limiter, DEFAULT_INCLUDE, getMatchModels, getMatchContext, getBotPredictions,
  getMl1x2, listBots, getUpcomingMatches, fetchMatchBundle, getFootballDataFixtures, ApiError,
};
