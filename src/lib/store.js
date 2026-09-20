/**
 * Persistență simplă pe disc (JSONL pe zi). Suficientă pentru tracking de
 * acuratețe/ROI fără a atinge baza PredictCamp.
 */
import { mkdir, appendFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.PREDICTBOT_DATA_DIR
  ? path.resolve(process.env.PREDICTBOT_DATA_DIR)
  : path.resolve(process.cwd(), 'data', 'predictions');

export async function savePrediction(prediction) {
  await mkdir(ROOT, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, `${day}.jsonl`);
  await appendFile(file, `${JSON.stringify(prediction)}\n`, 'utf8');
  return file;
}

export async function loadPredictions({ since } = {}) {
  if (!existsSync(ROOT)) return [];
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.jsonl')).sort();
  const out = [];
  for (const f of files) {
    if (since && f.slice(0, 10) < since) continue;
    const raw = await readFile(path.join(ROOT, f), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* linie coruptă — ignorată */ }
    }
  }
  return out;
}

export const DATA_DIR = ROOT;
export default { savePrediction, loadPredictions, DATA_DIR };
