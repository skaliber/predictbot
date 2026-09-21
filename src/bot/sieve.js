/**
 * Sita: din ~40 de meciuri, scoate cele 3-4 cele mai apropiate de realitate,
 * și spune clar pe care să le lași.
 *
 * VALIDAT (scripts/sieveReport.js, 320 de zile cu ~36 de meciuri, top 4/zi):
 *
 *   metodă              au ieșit   bilet 2   bilet 3    ROI
 *   doar piața            80.5%     71.3%     56.3%    +0.1%
 *   doar modelul          77.1%     67.8%     51.9%    −1.2%
 *   piață + model ±3pp    78.0%     70.0%     53.8%    −2.1%
 *
 * Deci ordonarea se face PUR după probabilitatea pieței. Ajustarea modelului,
 * chiar plafonată la ±3 puncte, reordona clasamentul spre alegeri mai slabe.
 * Iar filtrul de dezacord model–piață nu contează aici: în top 4 al pieței,
 * modelul nu e de acord doar în 3 cazuri din 1.280.
 *
 * Modelul rămâne în două roluri: rezervă când lipsesc cotele, și context
 * pentru pasul de chatbot/presă. Nu la ordonare.
 */

const OUT = ['1', 'X', '2'];
const argmax = (a) => a.indexOf(Math.max(...a));

/** Penalizarea când lipsesc cotele: probabilitatea din model e mai puțin precisă. */
export const NO_ODDS_PENALTY = 8;

/**
 * Scorul de sită. Mai mare = candidat mai bun.
 * Cu cote: probabilitatea pieței de-vigată, nemodificată.
 * Fără cote: probabilitatea modelului, penalizată.
 */
export function sieveScore({ market, model }) {
  const p = market ?? model;
  if (!p) return null;
  const pick = argmax(p);
  const notes = [];
  let score = p[pick] * 100;

  if (!market) {
    score -= NO_ODDS_PENALTY;
    notes.push('fără cote — probabilitate doar din model, mai puțin precisă');
  } else if (model) {
    // Informație pentru pasul următor, NU influențează ordonarea.
    const mk = argmax(model);
    if (mk !== pick) notes.push(`modelul ar alege „${OUT[mk]}" — verifică presa`);
    else notes.push(`model de acord (${(model[pick] * 100).toFixed(0)}%)`);
  }

  return {
    score: Math.round(score * 10) / 10,
    pick: OUT[pick],
    prob: p[pick],
    probs: p,
    fairOdds: 1 / p[pick],
    source: market ? 'piață' : 'model',
    notes,
  };
}

/**
 * Ordonează slate-ul și împarte în „joacă" (primele N) și „lasă".
 * Nu completează lista cu candidați sub `minProb`.
 */
export function rankSlate(matches, { top = 4, minProb = 0.5 } = {}) {
  const scored = matches.map((m) => ({ ...m, sieve: sieveScore(m) })).filter((m) => m.sieve);
  scored.sort((a, b) => b.sieve.score - a.sieve.score);
  const play = [], leave = [];
  for (const m of scored) {
    if (play.length < top && m.sieve.prob >= minProb) play.push(m);
    else {
      m.leaveReason = m.sieve.prob < minProb
        ? `probabilitate ${(m.sieve.prob * 100).toFixed(0)}% sub prag`
        : 'în afara primilor candidați';
      leave.push(m);
    }
  }
  return { play, leave };
}

/** Șansa ca primele n pick-uri să iasă împreună (independență asumată). */
export function slipProbability(picks, n) {
  return picks.slice(0, n).reduce((acc, m) => acc * m.sieve.prob, 1);
}

export default { sieveScore, rankSlate, slipProbability, NO_ODDS_PENALTY };
