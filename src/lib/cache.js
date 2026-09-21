/**
 * Cache pe disc pentru meciuri terminate. Rezultatele istorice nu se schimbă,
 * iar re-descărcarea lor consumă degeaba rate limit — la rulări repetate de
 * experimente, ajungeai să aștepți fereastra serverului în loc să calculezi.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import log from './log.js';

const DIR = process.env.PREDICTBOT_CACHE_DIR
  ? path.resolve(process.env.PREDICTBOT_CACHE_DIR)
  : path.resolve(process.cwd(), 'data', 'cache');

const keyOf = (parts) => parts.map((p) => String(p).replace(/[^\w.-]/g, '_')).join('__');

/**
 * Întoarce valoarea din cache, sau o calculează și o salvează.
 * `ttlMs` = 0 înseamnă „nu expiră" (potrivit pentru meciuri terminate).
 */
export async function cached(parts, producer, { ttlMs = 0 } = {}) {
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${keyOf(parts)}.json`);
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (!ttlMs || Date.now() - raw.saved_at < ttlMs) {
        log.debug('cache_hit', { file: path.basename(file), items: raw.data?.length });
        return raw.data;
      }
    } catch { /* cache corupt — se recalculează */ }
  }
  const data = await producer();
  await writeFile(file, JSON.stringify({ saved_at: Date.now(), data }), 'utf8');
  return data;
}

export const CACHE_DIR = DIR;
export default { cached, CACHE_DIR };
