/**
 * Potrivirea meciurilor între surse cu nume de echipe diferite.
 *
 * PredictCamp: „FC Rapid Bucuresti", „Sport Lisboa e Benfica", „Arsenal FC".
 * football-data: „Rapid Bucuresti", „Benfica", „Arsenal".
 *
 * Potrivirea pe nume singură ar fi fragilă. Dar restrânsă la aceeași ligă și
 * aceeași zi (±1 pentru fus orar), sunt doar câteva candidate — deci o
 * similaritate aproximativă e suficientă și sigură.
 */

/** Cuvinte care nu identifică echipa. */
const NOISE = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ssc', 'fk', 'sk', 'if', 'bk', 'cd', 'ud', 'sd', 'rc', 'rcd',
  'club', 'de', 'la', 'le', 'el', 'the', 'sport', 'sporting', 'clube', 'calcio', 'futbol', 'football',
  'e', 'y', 'and', 'city', 'town', 'united', 'utd', 'cfc', 'csm', 'cs', 'acs', 'sv', 'vfb', 'vfl', 'tsg',
  '1909', '1907', '1910', '1913', '1899', '04', '05', '09', '96', '1846', '1860', '1904', '1906',
]);

/** Normalizare: fără diacritice, litere mici, fără punctuație. */
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokenii semnificativi ai unui nume. */
export function tokens(name) {
  return normalizeName(name).split(' ').filter((t) => t && !NOISE.has(t));
}

/**
 * Similaritate între două nume, 0–1. Combină suprapunerea de tokeni cu
 * potrivirea pe prefix (ex. „nott" ⊂ „nottingham", „man" ⊂ „manchester").
 */
export function nameSimilarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) {
    // Numele sunt doar cuvinte „zgomot" (ex. „FC Utd") — comparăm brut.
    return normalizeName(a) === normalizeName(b) ? 1 : 0;
  }
  const match = (x, y) => x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y));
  let hits = 0;
  for (const x of ta) if (tb.some((y) => match(x, y))) hits++;
  // Normalizat pe numele mai scurt: „Benfica" vs „Sport Lisboa e Benfica" = 1.
  return hits / Math.min(ta.length, tb.length);
}

const dayShift = (date, d) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

/**
 * Pentru fiecare meci din `left`, găsește perechea din `right` (aceeași ligă,
 * aceeași zi ±1) cu cea mai bună similaritate pe AMBELE echipe.
 *
 * Refuză potrivirile ambigue: dacă a doua variantă e aproape la fel de bună,
 * nu ghicim — un meci greșit lipit ar strica exact comparația de preț.
 */
export function matchFixtures(left, right, { minScore = 0.5, ambiguityGap = 0.15 } = {}) {
  const byDay = new Map();
  for (const r of right) {
    const k = r.date;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  const out = [];
  let unmatched = 0, ambiguous = 0;
  for (const l of left) {
    const pool = [-1, 0, 1].flatMap((d) => byDay.get(dayShift(l.date, d)) ?? []);
    const scored = pool.map((r) => ({
      r,
      s: Math.min(nameSimilarity(l.home, r.home), nameSimilarity(l.away, r.away)),
    })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best || best.s < minScore) { unmatched++; continue; }
    if (scored[1] && best.s - scored[1].s < ambiguityGap && scored[1].s >= minScore) { ambiguous++; continue; }
    out.push({ left: l, right: best.r, score: best.s });
  }
  return { pairs: out, unmatched, ambiguous };
}

export default { normalizeName, tokens, nameSimilarity, matchFixtures };
