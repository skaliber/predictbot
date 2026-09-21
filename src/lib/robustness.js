/**
 * Verificări de robustețe preluate din lnmomo/Gambling
 * (docs/17_profit_algorithm_findings.md), care sunt mai stricte decât ce
 * aveam:
 *
 *  1. Bootstrap pe BLOCURI DE ZI, nu pe pariu. Pariurile din aceeași zi sunt
 *     corelate (aceeași rundă, aceleași știri, aceeași mișcare de piață);
 *     tratate ca independente, intervalul de încredere iese prea îngust și
 *     un rezultat norocos arată semnificativ.
 *  2. Concentrarea profitului: dacă 5 câștiguri fac majoritatea profitului,
 *     „strategia" e de fapt câteva nimereli.
 *  3. Testul sign-flip: e profitul distinct de zero sub ipoteza nulă că
 *     semnul fiecărei zile e aleator?
 */

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grupează pariurile pe zi: fiecare zi = { stake, profit }. */
export function dailyBlocks(bets) {
  const days = new Map();
  for (const b of bets) {
    const day = String(b.date ?? '').slice(0, 10) || 'fara-data';
    const cur = days.get(day) ?? { day, stake: 0, profit: 0, n: 0 };
    cur.stake += b.stake ?? 1;
    cur.profit += b.profit ?? (b.hit ? b.odds - 1 : -1);
    cur.n += 1;
    days.set(day, cur);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Bootstrap pe blocuri de zi pentru ROI. Aceleași setări ca în proiectul de
 * referință (seed 42, 5000 de iterații), ca rezultatele să fie comparabile.
 */
export function blockBootstrapRoi(bets, { iterations = 5000, seed = 42 } = {}) {
  const days = dailyBlocks(bets);
  if (!days.length) return null;
  const rand = makeRng(seed);
  const rois = [];
  for (let it = 0; it < iterations; it++) {
    let stake = 0, profit = 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[(rand() * days.length) | 0];
      stake += d.stake;
      profit += d.profit;
    }
    rois.push(stake > 0 ? (profit / stake) * 100 : 0);
  }
  rois.sort((a, b) => a - b);
  const q = (p) => rois[Math.min(rois.length - 1, Math.floor(p * rois.length))];
  const totalStake = days.reduce((s, d) => s + d.stake, 0);
  const totalProfit = days.reduce((s, d) => s + d.profit, 0);
  return {
    roi_pct: totalStake ? (totalProfit / totalStake) * 100 : 0,
    p05: q(0.05), p50: q(0.5), p95: q(0.95),
    prob_positive: rois.filter((r) => r > 0).length / rois.length,
    days: days.length,
    iterations,
  };
}

/** Ce fracțiune din profit vine din cele mai mari `k` câștiguri. */
export function profitConcentration(bets, k = 5) {
  const profits = bets.map((b) => b.profit ?? (b.hit ? b.odds - 1 : -1));
  const total = profits.reduce((a, c) => a + c, 0);
  if (!(total > 0)) return { top_k_share: null, total, k };
  const top = [...profits].sort((a, b) => b - a).slice(0, k).reduce((a, c) => a + c, 0);
  return { top_k_share: top / total, total, k };
}

/**
 * Test sign-flip pe profitul zilnic: sub ipoteza nulă, fiecare zi e la fel de
 * probabil să aibă semnul inversat. p-valoarea e fracțiunea de permutări cu
 * profit total cel puțin la fel de mare ca cel observat.
 */
export function signFlipPValue(bets, { iterations = 5000, seed = 42 } = {}) {
  const days = dailyBlocks(bets);
  if (!days.length) return null;
  const observed = days.reduce((s, d) => s + d.profit, 0);
  const rand = makeRng(seed);
  let atLeast = 0;
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (const d of days) s += rand() < 0.5 ? d.profit : -d.profit;
    if (s >= observed) atLeast++;
  }
  return (atLeast + 1) / (iterations + 1);
}

/**
 * EV conservator: probabilitatea e trasă în jos cu o marjă de incertitudine
 * (dispersia dintre case), iar cota e redusă cu un haircut de execuție
 * (slippage, limite de miză, cote care se mișcă până plasezi).
 */
export function conservativeEv({ prob, odds, uncertainty = 0.01, haircut = 0.02 }) {
  if (!(prob > 0 && prob < 1) || !(odds > 1)) return null;
  const p = Math.max(0, prob - uncertainty);
  const o = 1 + (odds - 1) * (1 - haircut);
  return p * o - 1;
}

/**
 * Verdictul complet, în stilul porții de promovare din proiectul de referință:
 * toate condițiile trebuie să treacă, „aproape" înseamnă FAIL.
 */
export function promotionVerdict(bets, { minBets = 200, minDays = 30, maxTopShare = 0.5, maxP = 0.05 } = {}) {
  const boot = blockBootstrapRoi(bets);
  const conc = profitConcentration(bets);
  const p = signFlipPValue(bets);
  const reasons = [];
  if (bets.length < minBets) reasons.push(`n=${bets.length} < ${minBets}`);
  if (!boot || boot.days < minDays) reasons.push(`zile=${boot?.days ?? 0} < ${minDays}`);
  if (!boot || boot.p05 <= 0) reasons.push(`ROI p05 ${boot ? boot.p05.toFixed(2) : '—'}% ≤ 0`);
  if (conc.top_k_share !== null && conc.top_k_share > maxTopShare) {
    reasons.push(`top-5 câștiguri = ${(conc.top_k_share * 100).toFixed(0)}% din profit`);
  }
  if (p === null || p > maxP) reasons.push(`sign-flip p=${p === null ? '—' : p.toFixed(3)}`);
  return { verdict: reasons.length ? 'FAIL' : 'PASS', reasons, bootstrap: boot, concentration: conc, sign_flip_p: p };
}

export default {
  dailyBlocks, blockBootstrapRoi, profitConcentration,
  signFlipPValue, conservativeEv, promotionVerdict,
};
