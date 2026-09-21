/**
 * Sita: din ~40 de meciuri, scoate cele 3-4 cele mai apropiate de realitate,
 * și spune clar pe care să le lași.
 *
 * Nu caută „edge" față de piață — cercetarea a arătat că modelele nu-l au.
 * Caută pick-urile cu cea mai mare probabilitate reală de a ieși, ca timpul
 * petrecut apoi în chatbot și la presă să meargă pe candidații buni.
 *
 * Principii, din cercetare (RESEARCH.md):
 *  · Cea mai bună estimare a realității e cota pieței de-vigată — a bătut
 *    toate modelele testate. Modelul doar o ajustează, plafonat (±3 puncte),
 *    ca în lnmomo/Gambling.
 *  · Dezacordul model–piață e cel mai puternic semnal de „lasă": când modelele
 *    sunt de acord între ele dar contra pieței, pick-ul iese în 17.9% din cazuri.
 */

/** Cât are voie modelul să mute probabilitatea pieței, în fracții. */
export const RESIDUAL_CAP = Number(process.env.SIEVE_RESIDUAL_CAP ?? 0.03);

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Probabilitatea ancorată pe piață: piața + ajustarea modelului, plafonată,
 * apoi re-normalizată la sumă 1.
 *
 * Re-normalizarea contează: fără ea, trei ajustări independente pot „fabrica"
 * masă de probabilitate (suma > 1) și implicit EV fals — capcană documentată
 * în lnmomo/Gambling.
 */
export function anchoredProbs(market, model, cap = RESIDUAL_CAP) {
  if (!market) return model ? [...model] : null;
  if (!model) return [...market];
  const raw = market.map((m, i) => Math.max(0.001, m + clamp(model[i] - m, -cap, cap)));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / sum);
}

/** Indexul rezultatului cel mai probabil. */
const argmax = (a) => a.indexOf(Math.max(...a));
const OUT = ['1', 'X', '2'];

/**
 * Scorul de sită pentru un meci. Mai mare = candidat mai bun.
 *
 * Pornește de la probabilitatea ancorată a pick-ului, apoi:
 *  · penalizare mare dacă modelul și piața aleg favoriți diferiți
 *  · bonus mic dacă sunt de acord (confirmare independentă)
 *  · penalizare fără cote: probabilitatea vine doar din model, mai puțin precisă
 */
export function sieveScore({ market, model }) {
  const p = anchoredProbs(market, model);
  if (!p) return null;
  const pick = argmax(p);
  const reasons = [];
  let score = p[pick] * 100;

  if (!market) {
    score -= 8;
    reasons.push('fără cote — probabilitate doar din model');
  } else if (model) {
    const modelPick = argmax(model);
    const marketPick = argmax(market);
    if (modelPick !== marketPick) {
      score -= 25;
      reasons.push(`modelul zice „${OUT[modelPick]}", piața „${OUT[marketPick]}"`);
    } else {
      // Cât de strâns sunt de acord pe probabilitatea pick-ului.
      const gap = Math.abs(model[pick] - market[pick]);
      if (gap < 0.05) { score += 3; reasons.push('model și piață de acord'); }
      else if (gap > 0.12) { score -= 6; reasons.push(`același pick, dar diferă cu ${(gap * 100).toFixed(0)} puncte`); }
    }
  }

  return {
    score: Math.round(score * 10) / 10,
    pick: OUT[pick],
    prob: p[pick],
    probs: p,
    fairOdds: 1 / p[pick],
    reasons,
  };
}

/**
 * Ordonează slate-ul și împarte în „joacă" (primele N) și „lasă".
 * Un pick sub `minProb` e lăsat indiferent de loc — nu completăm lista cu
 * candidați slabi doar ca să ajungem la N.
 */
export function rankSlate(matches, { top = 4, minProb = 0.5 } = {}) {
  const scored = matches
    .map((m) => ({ ...m, sieve: sieveScore(m) }))
    .filter((m) => m.sieve);
  scored.sort((a, b) => b.sieve.score - a.sieve.score);

  const play = [], leave = [];
  for (const m of scored) {
    const weak = m.sieve.prob < minProb;
    const conflict = m.sieve.reasons.some((r) => r.startsWith('modelul zice'));
    if (play.length < top && !weak && !conflict) play.push(m);
    else {
      m.leaveReason = conflict ? m.sieve.reasons[0]
        : weak ? `probabilitate ${(m.sieve.prob * 100).toFixed(0)}% sub prag`
        : 'în afara primelor candidați';
      leave.push(m);
    }
  }
  return { play, leave };
}

export default { anchoredProbs, sieveScore, rankSlate, RESIDUAL_CAP };
