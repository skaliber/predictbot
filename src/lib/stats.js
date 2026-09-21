/**
 * Statistici pentru validarea regulilor: intervale de încredere, calibrare,
 * și efectul individual al fiecărui flag.
 */

/**
 * Interval Wilson pentru o proporție. Preferat față de intervalul normal:
 * rămâne valid la eșantioane mici și nu iese din [0,1].
 */
export function wilsonInterval(successes, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    Math.max(0, ((centre - spread) / denom) * 100),
    Math.min(100, ((centre + spread) / denom) * 100),
  ];
}

const TIER_ORDER = ['SAFE', 'MODERATE', 'RISKY', 'EXCLUDED', 'NO_BET'];

/** Rata de reușită și ROI per tier. */
export function tierTable(rows) {
  const out = [];
  for (const tier of TIER_ORDER) {
    const group = rows.filter((r) => r.tier === tier);
    if (!group.length) continue;
    const wins = group.filter((r) => r.hit).length;
    const withOdds = group.filter((r) => Number.isFinite(r.odds));
    const flatProfit = withOdds.reduce((s, r) => s + (r.hit ? r.odds - 1 : -1), 0);
    const kellyStaked = withOdds.reduce((s, r) => s + (r.kelly_stake ?? 0), 0);
    const kellyProfit = withOdds.reduce(
      (s, r) => s + (r.hit ? (r.kelly_stake ?? 0) * (r.odds - 1) : -(r.kelly_stake ?? 0)), 0);
    out.push({
      tier,
      n: group.length,
      wins,
      hit_rate_pct: (wins / group.length) * 100,
      ci95: wilsonInterval(wins, group.length),
      mean_prob_pct: group.reduce((s, r) => s + r.prob_pct, 0) / group.length,
      n_with_odds: withOdds.length,
      roi_flat_pct: withOdds.length ? (flatProfit / withOdds.length) * 100 : null,
      roi_kelly_pct: kellyStaked > 0 ? (kellyProfit / kellyStaked) * 100 : null,
    });
  }
  return out;
}

/**
 * Calibrare: grupăm pe bucket-uri de probabilitate declarată și comparăm cu
 * frecvența reală. Un model calibrat spune 70% și nimerește în ~70% din cazuri.
 */
export function calibrationBuckets(rows, edges = [0, 40, 50, 60, 70, 80, 101]) {
  // NO_BET nu are probabilitate declarată — nu intră în calibrare.
  rows = rows.filter((r) => r.selection);
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const group = rows.filter((r) => r.prob_pct >= lo && r.prob_pct < hi);
    if (!group.length) continue;
    const wins = group.filter((r) => r.hit).length;
    const meanProb = group.reduce((s, r) => s + r.prob_pct, 0) / group.length;
    const actual = (wins / group.length) * 100;
    out.push({
      bucket: `${lo}–${hi === 101 ? 100 : hi}%`,
      n: group.length,
      mean_prob_pct: meanProb,
      actual_pct: actual,
      error_pp: actual - meanProb,
      ci95: wilsonInterval(wins, group.length),
    });
  }
  return out;
}

/**
 * Efectul unui flag: rata de reușită pe meciurile unde a apărut, față de cele
 * unde nu. Un flag util trebuie să aibă `delta_pp` negativ — adică semnalează
 * pick-uri care chiar ies mai rar.
 */
export function flagTable(rows) {
  rows = rows.filter((r) => r.selection);
  const codes = [...new Set(rows.flatMap((r) => r.flags.map((f) => f.code)))];
  const out = [];
  for (const code of codes) {
    const withF = rows.filter((r) => r.flags.some((f) => f.code === code));
    const without = rows.filter((r) => !r.flags.some((f) => f.code === code));
    if (!withF.length || !without.length) continue;
    const hw = withF.filter((r) => r.hit).length / withF.length * 100;
    const ho = without.filter((r) => r.hit).length / without.length * 100;
    out.push({
      code, n: withF.length,
      hit_with_pct: hw, hit_without_pct: ho, delta_pp: hw - ho,
      ci95_with: wilsonInterval(withF.filter((r) => r.hit).length, withF.length),
    });
  }
  return out.sort((a, b) => a.delta_pp - b.delta_pp);
}

export default { wilsonInterval, tierTable, calibrationBuckets, flagTable };
