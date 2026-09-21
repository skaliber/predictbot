/**
 * Closing Line Value — metrica de acceptare.
 *
 * ROI-ul e zgomotos: 200 de pariuri nu ajung ca să distingi +3% de −3%.
 * CLV măsoară dacă ai prins un preț mai bun decât cel de închidere, ceea ce
 * converge mult mai repede și e greu de obținut din noroc.
 *
 * Aici nu avem cote de deschidere per pariu, deci CLV se măsoară ca diferența
 * dintre probabilitatea modelului și cea de-vigată de închidere: dacă modelul
 * vede sistematic mai bine decât închiderea, are edge.
 */
import { devig } from '../betting/odds.js';

/** Probabilitățile corecte (de-vigate) ale pieței de închidere. */
export function closingProbs(odds, method = 'shin') {
  if (!Array.isArray(odds) || odds.some((o) => !(o > 1))) return null;
  return devig(odds, { method }).fair_probabilities;
}

/**
 * CLV real: ai pariat la cota de DESCHIDERE, iar piața a închis altundeva.
 * Dacă linia s-a mișcat spre selecția ta, ai prins un preț mai bun decât
 * consensul final — asta e edge, și converge mult mai repede decât ROI-ul.
 *
 *   CLV (pp) = prob_corectă_la_închidere − prob_corectă_la_prețul_tău
 *
 * ⚠️ NU compara probabilitatea MODELULUI cu închiderea și numi asta CLV:
 * dacă selectezi pariurile după „model − închidere ≥ prag", atunci acea
 * diferență e pozitivă prin construcție și nu măsoară nimic.
 */
export function clvPoints({ openProb, closingProb }) {
  if (!Number.isFinite(openProb) || !Number.isFinite(closingProb)) return null;
  return (closingProb - openProb) * 100;
}

/** CLV în procente de cotă: cât de mult mai bun a fost prețul tău. */
export function clvOddsPct({ openOdds, closeOdds }) {
  if (!(openOdds > 1) || !(closeOdds > 1)) return null;
  return (openOdds / closeOdds - 1) * 100;
}

/** Log-loss pentru o distribuție de probabilități față de rezultatul real. */
export function logLoss(probs, outcome) {
  const i = { '1': 0, X: 1, '2': 2 }[outcome];
  if (i === undefined) return null;
  const p = Math.max(1e-12, Math.min(1, probs[i]));
  return -Math.log(p);
}

/** Log-loss binar (Over/Under, BTTS). */
export function logLossBinary(prob, happened) {
  const p = Math.max(1e-12, Math.min(1 - 1e-12, prob));
  return happened ? -Math.log(p) : -Math.log(1 - p);
}

/**
 * Bootstrap pe ROI: reeșantionează pariurile cu înlocuire și întoarce
 * intervalul 95%. Mai onest decât eroarea standard când distribuția
 * profitului e puternic asimetrică (majoritatea −1, rar +cotă).
 */
export function bootstrapRoi(bets, { iterations = 2000, seed = 7 } = {}) {
  if (!bets.length) return null;
  const profits = bets.map((b) => (b.hit ? b.odds - 1 : -1));
  let rng = seed >>> 0;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const means = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < profits.length; i++) s += profits[(rand() * profits.length) | 0];
    means.push(s / profits.length);
  }
  means.sort((a, b) => a - b);
  const at = (q) => means[Math.min(means.length - 1, Math.floor(q * means.length))] * 100;
  const mean = profits.reduce((a, c) => a + c, 0) / profits.length;
  return { roi_pct: mean * 100, ci95: [at(0.025), at(0.975)], iterations };
}

/** Rezumatul unui slice, cu criteriul de promovare aplicat. */
export function sliceSummary(bets, { minN = 200 } = {}) {
  if (!bets.length) return null;
  const boot = bootstrapRoi(bets);
  const clvs = bets.map((b) => b.clv).filter((x) => Number.isFinite(x));
  const meanClv = clvs.length ? clvs.reduce((a, c) => a + c, 0) / clvs.length : null;
  const wins = bets.filter((b) => b.hit).length;

  const modelLoss = bets.map((b) => b.logLossModel).filter(Number.isFinite);
  const marketLoss = bets.map((b) => b.logLossMarket).filter(Number.isFinite);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  const pass = meanClv !== null && meanClv > 0 && boot.roi_pct > 0 && bets.length >= minN;
  return {
    n: bets.length,
    hit_rate_pct: (wins / bets.length) * 100,
    roi_pct: boot.roi_pct,
    roi_ci95: boot.ci95,
    mean_clv_pp: meanClv,
    logloss_model: avg(modelLoss),
    logloss_market: avg(marketLoss),
    mean_odds: bets.reduce((a, b) => a + b.odds, 0) / bets.length,
    verdict: pass ? 'PASS' : 'FAIL',
    fail_reasons: pass ? [] : [
      ...(bets.length < minN ? [`n=${bets.length} < ${minN}`] : []),
      ...(meanClv === null || meanClv <= 0 ? ['CLV ≤ 0'] : []),
      ...(boot.roi_pct <= 0 ? ['ROI ≤ 0'] : []),
    ],
  };
}

export default { closingProbs, clvPoints, clvOddsPct, logLoss, logLossBinary, bootstrapRoi, sliceSummary };
