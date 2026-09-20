#!/usr/bin/env node
/**
 * Atașează rezultatele reale predicțiilor salvate și rescrie fișierele JSONL.
 * Rulează după ce meciurile s-au terminat (ex. zilnic la 02:00).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getMatch } from '../src/dataFetcher.js';
import { DATA_DIR } from '../src/lib/store.js';
import { summarize } from '../src/lib/accuracy.js';
import log from '../src/lib/log.js';

async function main() {
  if (!existsSync(DATA_DIR)) { console.log('Nu există predicții salvate.'); return; }
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.jsonl'));
  const cache = new Map();
  let updated = 0;
  const all = [];

  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const lines = (await readFile(full, 'utf8')).split('\n').filter((l) => l.trim());
    const out = [];
    for (const line of lines) {
      let p;
      try { p = JSON.parse(line); } catch { out.push(line); continue; }
      if (!p.result && p.slug) {
        if (!cache.has(p.slug)) {
          try { cache.set(p.slug, await getMatch(p.slug)); }
          catch (err) { log.warn('settle_fetch_failed', { slug: p.slug, error: err.message }); cache.set(p.slug, null); }
        }
        const m = cache.get(p.slug);
        if (m && m.status === 'FINISHED' && Number.isFinite(m.score_home)) {
          p.result = { score_home: m.score_home, score_away: m.score_away, settled_at: new Date().toISOString() };
          updated++;
        }
      }
      all.push(p);
      out.push(JSON.stringify(p));
    }
    await writeFile(full, `${out.join('\n')}\n`, 'utf8');
  }

  console.log(JSON.stringify({ files: files.length, newly_settled: updated, summary: summarize(all) }, null, 2));
}

main().catch((err) => { console.error('Settle eșuat:', err.message); process.exitCode = 1; });
