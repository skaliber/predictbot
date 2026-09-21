/**
 * Meta-learner prin regresie logistică multinomială peste predicțiile
 * modelelor de bază — abordarea „stacking" (vezi soumendu-11/fifa-wc2026-predictor).
 *
 * Diferența față de blendingul cu ponderi fixe: meta-learnerul poate învăța
 * recalibrare (a trage predicțiile spre centru acolo unde modelele sunt prea
 * sigure) și interacțiuni, nu doar o medie ponderată.
 *
 * Adăugirea importantă: **prețul pieței poate intra ca feature**. Dacă un
 * model are informație pe care piața n-o are, stackingul cu piață ca feature
 * ar trebui să bată piața singură. Dacă nu o bate, modelul e redundant — și
 * atunci nicio arhitectură nu ajută.
 */

const CLASSES = 3; // 1, X, 2

/** Softmax numeric stabil. */
function softmax(z) {
  const max = Math.max(...z);
  const exp = z.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}

/** Logit cu tăiere, ca o probabilitate zero să nu producă infinit. */
export function safeLogit(p, eps = 1e-6) {
  const q = Math.min(1 - eps, Math.max(eps, p));
  return Math.log(q / (1 - q));
}

/**
 * Construiește matricea de meta-features dintr-un set de predicții de bază.
 *
 * Probabilitățile intră ca logit, nu brut: regresia logistică e liniară în
 * logit, deci acolo un model bun devine un feature aproape suficient.
 *
 * @param {object[]} rows fiecare cu { sources: {name: [p1,pX,p2]}, extra: {} }
 * @param {string[]} sourceNames ordinea surselor, fixă între antrenare și test
 * @param {string[]} extraNames feature-uri scalare suplimentare
 */
export function buildMetaFeatures(rows, sourceNames, extraNames = []) {
  return rows.map((r) => {
    const f = [];
    for (const name of sourceNames) {
      const p = r.sources?.[name];
      // Sursă lipsă → logit neutru (probabilitate 1/3), ca să nu strice
      // alinierea coloanelor între antrenare și test.
      for (let k = 0; k < CLASSES; k++) f.push(safeLogit(p ? p[k] : 1 / CLASSES));
    }
    for (const name of extraNames) {
      const v = r.extra?.[name];
      f.push(Number.isFinite(v) ? v : 0);
    }
    return f;
  });
}

/** Standardizare: media 0, abaterea 1. Regresia converge mult mai prost fără. */
export function fitScaler(X) {
  const n = X.length, d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

export function applyScaler(X, { mean, std }) {
  return X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));
}

/**
 * Regresie logistică multinomială, antrenată prin gradient descent cu
 * penalizare L2. Datele sunt puține și corelate, deci regularizarea contează
 * mai mult decât rafinamentul optimizatorului.
 */
export function trainMultinomial(X, y, { iterations = 300, learningRate = 0.3, l2 = 1.0 } = {}) {
  const n = X.length;
  if (!n) throw new Error('trainMultinomial: set de antrenare gol');
  const d = X[0].length;
  // W[k][j] + bias[k]
  const W = Array.from({ length: CLASSES }, () => new Float64Array(d));
  const b = new Float64Array(CLASSES);

  for (let it = 0; it < iterations; it++) {
    const gradW = Array.from({ length: CLASSES }, () => new Float64Array(d));
    const gradB = new Float64Array(CLASSES);

    for (let i = 0; i < n; i++) {
      const z = new Array(CLASSES);
      for (let k = 0; k < CLASSES; k++) {
        let s = b[k];
        for (let j = 0; j < d; j++) s += W[k][j] * X[i][j];
        z[k] = s;
      }
      const p = softmax(z);
      for (let k = 0; k < CLASSES; k++) {
        const err = p[k] - (y[i] === k ? 1 : 0);
        gradB[k] += err / n;
        for (let j = 0; j < d; j++) gradW[k][j] += (err * X[i][j]) / n;
      }
    }

    const lr = learningRate / (1 + it / 100);
    for (let k = 0; k < CLASSES; k++) {
      b[k] -= lr * gradB[k];
      for (let j = 0; j < d; j++) {
        W[k][j] -= lr * (gradW[k][j] + (l2 * W[k][j]) / n);
      }
    }
  }
  return { W: W.map((r) => Array.from(r)), b: Array.from(b), d };
}

/** Predicție cu un model antrenat. */
export function predictMultinomial(model, x) {
  const z = model.b.map((bk, k) => {
    let s = bk;
    for (let j = 0; j < model.d; j++) s += model.W[k][j] * x[j];
    return s;
  });
  return softmax(z);
}

/** Antrenează pe rânduri brute și întoarce un predictor gata de folosit. */
export function trainStack(rows, labels, { sourceNames, extraNames = [], ...opts } = {}) {
  const Xraw = buildMetaFeatures(rows, sourceNames, extraNames);
  const scaler = fitScaler(Xraw);
  const X = applyScaler(Xraw, scaler);
  const model = trainMultinomial(X, labels, opts);
  return {
    model, scaler, sourceNames, extraNames,
    predict(row) {
      const [x] = applyScaler(buildMetaFeatures([row], sourceNames, extraNames), scaler);
      return predictMultinomial(model, x);
    },
  };
}

export default {
  buildMetaFeatures, fitScaler, applyScaler,
  trainMultinomial, predictMultinomial, trainStack, safeLogit,
};
