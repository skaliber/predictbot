/**
 * Așteptări măsurate pe segmente de piață — 32.171 de meciuri, 22 de ligi,
 * 2021–2026 (vezi RESEARCH.md).
 *
 * Nu e un model. Sunt frecvențe observate: dacă pariezi orbește într-o anumită
 * categorie, cât pierzi în medie. Folosit ca verificare de realitate peste
 * orice pick, indiferent ce spune modelul.
 *
 * Toate valorile sunt NEGATIVE. Nu există categorie profitabilă în datele
 * noastre. Cea mai bună (favorit sub 1.60) e la −1.25% ± 0.70 — adică
 * indistinctă de zero, nu profitabilă.
 */

/** ROI mediu măsurat pentru un pariu plat, pe intervale de cotă. */
const BY_ODDS = [
  { max: 1.5, roi_pct: -1.19, n: 5649 },
  { max: 2.0, roi_pct: -3.56, n: 12000 },
  { max: 3.0, roi_pct: -5.40, n: 20585 },
  { max: 5.0, roi_pct: -7.69, n: 44606 },
  { max: 10.0, roi_pct: -16.32, n: 11369 },
  { max: Infinity, roi_pct: -35.81, n: 2304 },
];

/** ROI mediu pe poziție (pariu plat pe acel rezultat, la orice cotă). */
const BY_POSITION = {
  '1': { roi_pct: -6.38, n: 32171 },
  X: { roi_pct: -6.43, n: 32171 },
  '2': { roi_pct: -11.19, n: 32171 },
};

/** ROI mediu pe marja bookmakerului. */
const BY_MARGIN = [
  { max: 0.04, roi_pct: -5.99, n: 7842 },
  { max: 0.06, roi_pct: -6.58, n: 39627 },
  { max: 0.08, roi_pct: -8.28, n: 33843 },
  { max: 0.12, roi_pct: -12.01, n: 14778 },
  { max: Infinity, roi_pct: -15.84, n: 423 },
];

/** Ligi unde pariul pe favorit a fost semnificativ mai prost decât media. */
const WEAK_LEAGUES = {
  60: { name: 'Ekstraklasa', roi_pct: -11.81 },
  76: { name: 'MLS', roi_pct: -8.91 },
  77: { name: 'Championship', roi_pct: -6.99 },
  196: { name: 'Eredivisie', roi_pct: -7.71 },
  61: { name: 'Liga I', roi_pct: -8.00 },
  43: { name: 'Austrian Bundesliga', roi_pct: -8.08 },
};

const pick = (table, value) => table.find((r) => value < r.max) ?? table[table.length - 1];

/** Marja bookmakerului dintr-un set de cote 1X2. */
export function bookmakerMargin(odds) {
  if (!Array.isArray(odds) || odds.some((o) => !(o > 1))) return null;
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}

/**
 * Așteptarea istorică pentru un pariu, combinând segmentele.
 * Se ia cea mai pesimistă dintre estimări — sunt corelate, nu independente,
 * deci nu se adună.
 */
export function marketPrior({ selection, odds, allOdds, league }) {
  const parts = [];
  const effectiveOdds = oddsForSelection(selection, odds, allOdds);
  if (Number.isFinite(effectiveOdds)) {
    const b = pick(BY_ODDS, effectiveOdds);
    parts.push({ source: 'cotă', roi_pct: b.roi_pct, n: b.n });
  }
  if (BY_POSITION[selection]) {
    parts.push({ source: 'poziție', roi_pct: BY_POSITION[selection].roi_pct, n: BY_POSITION[selection].n });
  }
  const m = bookmakerMargin(allOdds);
  if (m !== null) {
    const b = pick(BY_MARGIN, m);
    parts.push({ source: 'marjă', roi_pct: b.roi_pct, n: b.n, margin_pct: m * 100 });
  }
  const weak = WEAK_LEAGUES[league];
  if (weak) parts.push({ source: 'ligă', roi_pct: weak.roi_pct, league: weak.name });

  if (!parts.length) return null;
  const worst = parts.reduce((a, b) => (b.roi_pct < a.roi_pct ? b : a));
  return {
    expected_roi_pct: worst.roi_pct,
    driver: worst.source,
    parts,
    margin_pct: m === null ? null : Math.round(m * 1000) / 10,
  };
}

const INDEX_OF = { '1': 0, X: 1, '2': 2 };

/**
 * Cota corespunzătoare selecției. Dacă avem setul complet, îl folosim pe el —
 * altfel am depinde de faptul că apelantul a trimis cota potrivită selecției,
 * ceea ce e o sursă tăcută de greșeli.
 */
export function oddsForSelection(selection, odds, allOdds) {
  const i = INDEX_OF[selection];
  if (Array.isArray(allOdds) && i !== undefined && Number.isFinite(allOdds[i])) return allOdds[i];
  return Number.isFinite(odds) ? odds : null;
}

/**
 * Categoria „cea mai puțin proastă" măsurată: favorit la cotă sub 1.60.
 * −1.25% ± 0.70, adică indistinctă de zero. Nu e profit, e pierdere minimă.
 */
export function isLeastBadCategory({ selection, odds, allOdds }) {
  if (!Array.isArray(allOdds) || selection === 'X') return false;
  const o = oddsForSelection(selection, odds, allOdds);
  if (!Number.isFinite(o) || o >= 1.6) return false;
  return o === Math.min(...allOdds);
}

export const TABLES = { BY_ODDS, BY_POSITION, BY_MARGIN, WEAK_LEAGUES };
export default { marketPrior, bookmakerMargin, isLeastBadCategory, oddsForSelection, TABLES };
