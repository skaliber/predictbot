/**
 * Regulile de screening pentru bilete. Partea deterministă a workflow-ului
 * /bets: ce se exclude, ce se degradează, ce rămâne „safe".
 *
 * Fiecare regulă întoarce un flag cu `severity`:
 *   'exclude'  — pick-ul nu intră pe bilet, indiferent de restul semnalelor
 *   'downgrade'— pick-ul poate intra, dar nu ca SAFE
 *   'note'     — informație care se raportează, fără efect pe tier
 */

/** Runde de calificare din cupele europene — date rare, calibrare slabă. */
const QUALIFYING_RE = /qualif|preliminar|1st round|2nd round|3rd round/i;
const EURO_CUPS = /conference league|europa league|champions league/i;

/**
 * Praguri, configurabile prin env ca să poată fi recalibrate fără schimbare de cod.
 * Valorile implicite sunt cele validate pe 912 meciuri (vezi BACKTEST.md).
 */
const SMALL_SAMPLE = Number(process.env.SCREEN_SMALL_SAMPLE ?? 30);
const POOR_FORM_MAX_WINS = Number(process.env.SCREEN_POOR_FORM_MAX_WINS ?? 1);

export function flag(code, severity, message, meta) {
  return { code, severity, message, ...(meta ? { meta } : {}) };
}

/**
 * Clasifică fallback-ul Dixon-Coles. Cele trei cauze au implicații diferite —
 * nu se tratează la fel (vezi secțiunea 3 din instrucțiunile de analiză).
 */
export function classifyFallback(models, { pickedSide } = {}) {
  const ds = models?.elitul?.dixon_coles?.data_sufficiency;
  const flags = [];
  if (!ds) return flags;

  const { homeIsFallback, awayIsFallback, homeHighLambdaLegitimate, awayHighLambdaLegitimate, sampleSize } = ds;

  if (homeIsFallback && awayIsFallback) {
    flags.push(flag(
      'DOUBLE_FALLBACK', 'exclude',
      'Fallback pe ambele echipe — 1X2 exclus. Piața de goluri poate rămâne validă dacă Poisson e neafectat.'
    ));
  } else if (homeIsFallback || awayIsFallback) {
    const side = homeIsFallback ? 'home' : 'away';
    const onPick = pickedSide === side;
    flags.push(flag(
      onPick ? 'FALLBACK_ON_PICK' : 'FALLBACK_OFF_PICK',
      onPick ? 'downgrade' : 'note',
      onPick
        ? `Fallback pe echipa aleasă (${side}) — încredere redusă.`
        : `Fallback pe echipa NE-aleasă (${side}) — acceptabil cu judecată.`,
      { side }
    ));
  }

  // Lambda tăiat la plafonul de plauzibilitate: de regulă SUSȚINE piața de goluri,
  // nu o slăbește — formă foarte ofensivă, nu date lipsă.
  if (homeHighLambdaLegitimate || awayHighLambdaLegitimate) {
    flags.push(flag(
      'LAMBDA_CAPPED', 'note',
      'Lambda tăiat la plafonul de plauzibilitate — susține mai degrabă o piață Peste X.5 decât să o slăbească.'
    ));
  }

  const minSample = Math.min(sampleSize?.home ?? Infinity, sampleSize?.away ?? Infinity);
  if (Number.isFinite(minSample) && minSample < SMALL_SAMPLE) {
    // Măsurat pe 912 meciuri: pick-urile cu acest flag ies cu +2.0pp MAI DES
    // decât cele fără. Pragul de 30 se aprinde pe 77% din meciuri, deci nu
    // discriminează nimic. Rămâne ca informație, nu ca penalizare.
    flags.push(flag(
      'SMALL_SAMPLE', 'note',
      `Eșantion mic pentru Dixon-Coles (${minSample} meciuri) — calibrare fragilă.`,
      { sample: minSample }
    ));
  }

  return flags;
}

/** Puncte și victorii din forma recentă (`context.home_form` / `away_form`). */
export function formSummary(form = []) {
  if (!form?.length) return null;
  const wins = form.filter((m) => m.result === 'W').length;
  const draws = form.filter((m) => m.result === 'D').length;
  return {
    matches: form.length,
    wins,
    draws,
    losses: form.length - wins - draws,
    points: wins * 3 + draws,
    max_points: form.length * 3,
    sequence: form.map((m) => m.result).join(''),
  };
}

/**
 * Veto pe formă: un consens de model 100% NU salvează o echipă cu 0-1 victorii
 * în ultimele 5. Cazul Liverpool din instrucțiuni.
 */
export function formVeto(context, pickedSide) {
  if (!pickedSide || pickedSide === 'draw') return [];
  const form = pickedSide === 'home' ? context?.home_form : context?.away_form;
  const s = formSummary(form);
  if (!s) return [flag('NO_FORM_DATA', 'downgrade', 'Fără date de formă pentru echipa aleasă.')];
  if (s.wins <= POOR_FORM_MAX_WINS) {
    // Măsurat pe 912 meciuri: efect real, dar mic (−4.7pp, 45.7% vs 50.5%).
    // `exclude` era prea dur — pick-urile astea ies totuși mai des decât cele
    // etichetate RISKY (42.8%), deci a le arunca complet pierdea valoare.
    return [flag(
      'POOR_FORM_PICK', 'downgrade',
      `Echipa aleasă are ${s.wins} victorii în ultimele ${s.matches} (${s.sequence}) — formă slabă, −4.7pp măsurat.`,
      s
    )];
  }
  if (s.points < s.max_points * 0.4) {
    return [flag('WEAK_FORM_PICK', 'downgrade', `Formă slabă: ${s.points}/${s.max_points} puncte (${s.sequence}).`, s)];
  }
  return [];
}

/** Runde de calificare europene — skip automat. */
export function competitionFilter(match) {
  const name = `${match?.league_name ?? ''} ${match?.stage ?? ''} ${match?.round ?? ''}`;
  if (EURO_CUPS.test(name) && QUALIFYING_RE.test(name)) {
    return [flag('QUALIFYING_ROUND', 'exclude', 'Rundă de calificare din cupele europene — date sparse.')];
  }
  return [];
}

/**
 * „100% STRONG" contrazis de piață: poate fi bug de calibrare a ponderilor,
 * nu semnal real. Se raportează explicit.
 */
export function consensusVsMarket(consensus, marketFairProbs) {
  if (!consensus?.available || consensus.agreement_pct < 100) return [];
  if (!marketFairProbs) return [];
  const label = { '1': 0, X: 1, '2': 2 }[consensus.consensus];
  if (label === undefined) return [];
  const marketProb = marketFairProbs[label];
  const marketTop = Math.max(...marketFairProbs);
  if (marketProb < marketTop - 0.05) {
    // Cel mai puternic semnal măsurat: −32.3pp (17.9% vs 50.1% pe 28 de meciuri).
    // Când toate modelele sunt de acord ÎMPOTRIVA pieței, modelele greșesc.
    return [flag(
      'CONSENSUS_VS_MARKET', 'exclude',
      `Ensemble dă 100% acord pe „${consensus.consensus}", dar piața îl vede la ${(marketProb * 100).toFixed(1)}% ` +
      `față de ${(marketTop * 100).toFixed(1)}% pentru alt rezultat. Măsurat pe istoric: astfel de pick-uri ies ` +
      `în 17.9% din cazuri, față de 50.1% în rest — piața are dreptate, nu modelul.`,
      { model: consensus.consensus, market_prob_pct: marketProb * 100 }
    )];
  }
  return [];
}

/**
 * Piețe alternative din granular-stats. Comparăm valoarea fixture-ului cu
 * baseline-ul ligii — probabilitățile brute din Poisson/MC nu sunt suficiente
 * pentru Over/Under și BTTS.
 */
export function granularMarkets(granular, { minSample = 10, minDelta = 10 } = {}) {
  const out = [];
  const summary = granular?.prediction_summary?.markets ?? [];
  for (const m of summary) {
    if (!Number.isFinite(m.value_pct) || !Number.isFinite(m.league_baseline_pct)) continue;
    if ((m.sample_size ?? 0) < minSample) continue;
    const delta = m.value_pct - m.league_baseline_pct;
    if (Math.abs(delta) < minDelta) continue;
    // value_pct e probabilitatea evenimentului „over"/„btts"; sub baseline ⇒ partea opusă.
    const over = delta > 0;
    const market = m.market === 'over_2_5' ? 'over_under' : m.market === 'btts' ? 'btts' : m.market;
    const selection = m.market === 'over_2_5'
      ? (over ? 'Over 2.5' : 'Under 2.5')
      : (over ? 'BTTS Yes' : 'BTTS No');
    out.push({
      market,
      selection,
      granular_pct: over ? m.value_pct : 100 - m.value_pct,
      league_baseline_pct: over ? m.league_baseline_pct : 100 - m.league_baseline_pct,
      delta_vs_baseline: Math.round(Math.abs(delta) * 10) / 10,
      sample_size: m.sample_size,
    });
  }
  return out.sort((a, b) => b.delta_vs_baseline - a.delta_vs_baseline);
}

/** Tier-ul final, din flag-uri + încredere + edge. */
export function tierFor({ flags, probPct, edgePct }) {
  if (flags.some((f) => f.severity === 'exclude')) return 'EXCLUDED';
  const downgrades = flags.filter((f) => f.severity === 'downgrade').length;
  const hasEdge = Number.isFinite(edgePct);

  if (downgrades === 0 && probPct >= 65 && (!hasEdge || edgePct >= 0)) return 'SAFE';
  if (downgrades === 0 && probPct >= 58) return 'SAFE';
  if (downgrades <= 1 && probPct >= 55) return 'MODERATE';
  return 'RISKY';
}

/** Scor 0–100 pentru ordonare. Nu e probabilitate, e prioritate de selecție. */
export function safetyScore({ probPct, edgePct, consensus, flags, granularDelta }) {
  let score = probPct ?? 50;
  if (consensus?.available) {
    score += (consensus.agreement_pct - 50) * 0.15;
    if (consensus.signal === 'STRONG') score += 4;
  }
  if (Number.isFinite(edgePct)) score += Math.max(-10, Math.min(10, edgePct));
  if (Number.isFinite(granularDelta)) score += Math.min(8, granularDelta * 0.3);
  for (const f of flags) {
    if (f.severity === 'exclude') score -= 100;
    else if (f.severity === 'downgrade') score -= 12;
  }
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

export const THRESHOLDS = { SMALL_SAMPLE, POOR_FORM_MAX_WINS };
export default {
  classifyFallback, formSummary, formVeto, competitionFilter,
  consensusVsMarket, granularMarkets, tierFor, safetyScore, flag, THRESHOLDS,
};
