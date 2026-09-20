const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

/**
 * Toate log-urile merg pe stderr, indiferent de nivel: stdout e rezervat
 * ieșirii programului (JSON-ul de rezultat al crawler-ului, tabelele CLI).
 * Altfel `node src/cron/botPredictCrawler.js | jq` primea log-uri intercalate
 * cu rezultatul și nu se putea parsa.
 */
function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, msg, ...(meta ? { meta } : {}) };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  debug: (m, x) => emit('debug', m, x),
  info: (m, x) => emit('info', m, x),
  warn: (m, x) => emit('warn', m, x),
  error: (m, x) => emit('error', m, x),
};
export default log;
