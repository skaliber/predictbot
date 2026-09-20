import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  api: {
    baseUrl: (process.env.PREDICTCAMP_API_BASE_URL || 'https://predictcamp.ro/api/public/v1').replace(/\/$/, ''),
    fallbackBaseUrl: (process.env.PREDICTCAMP_FALLBACK_BASE_URL || 'https://predictcamp.ro/api').replace(/\/$/, ''),
    apiKey: process.env.PREDICTCAMP_API_KEY?.trim() || undefined,
    locale: process.env.PREDICTCAMP_LOCALE || 'ro',
    timeoutMs: num(process.env.API_TIMEOUT_MS, 15000),
    retries: num(process.env.API_RETRIES, 2),
  },
  footballData: {
    token: process.env.FOOTBALL_DATA_TOKEN?.trim() || undefined,
    baseUrl: 'https://api.football-data.org/v4',
  },
  bot: {
    id: process.env.BOT_ID || 'ai-analyst',
    minEdgePct: num(process.env.MIN_EDGE_PCT, 3),
    minConfidence: num(process.env.MIN_CONFIDENCE, 52),
    kellyFraction: num(process.env.KELLY_FRACTION, 0.25),
    maxKellyStake: num(process.env.MAX_KELLY_STAKE, 0.05),
  },
  cron: {
    hoursAhead: num(process.env.HOURS_AHEAD, 48),
    hoursMin: num(process.env.HOURS_MIN, 2),
  },
  server: { port: num(process.env.PORT, 3081) },
  // Ponderi de blending pentru ensemble (se normalizează automat).
  ensembleWeights: {
    dixonColes: num(process.env.W_DIXON_COLES, 0.4),
    elo: num(process.env.W_ELO, 0.3),
    poisson: num(process.env.W_POISSON, 0.2),
    predictcamp: num(process.env.W_PREDICTCAMP, 0.1),
  },
};

export default config;
