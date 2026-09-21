import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFallback, formSummary, formVeto, competitionFilter,
  consensusVsMarket, granularMarkets, tierFor, safetyScore,
} from '../src/bot/screening.js';
import { buildSlips } from '../src/bot/betslips.js';

const codes = (fs) => fs.map((f) => f.code);
const sev = (fs, code) => fs.find((f) => f.code === code)?.severity;

test('fallback pe ambele echipe exclude 1X2', () => {
  const f = classifyFallback({ elitul: { dixon_coles: { data_sufficiency: {
    homeIsFallback: true, awayIsFallback: true, sampleSize: { home: 90, away: 90 },
  } } } });
  assert.ok(codes(f).includes('DOUBLE_FALLBACK'));
  assert.equal(sev(f, 'DOUBLE_FALLBACK'), 'exclude');
});

test('fallback pe echipa aleasă degradează, pe cea ne-aleasă doar informează', () => {
  const ds = { homeIsFallback: true, awayIsFallback: false, sampleSize: { home: 90, away: 90 } };
  const models = { elitul: { dixon_coles: { data_sufficiency: ds } } };

  const onPick = classifyFallback(models, { pickedSide: 'home' });
  assert.equal(sev(onPick, 'FALLBACK_ON_PICK'), 'downgrade');

  const offPick = classifyFallback(models, { pickedSide: 'away' });
  assert.equal(sev(offPick, 'FALLBACK_OFF_PICK'), 'note');
  assert.ok(!codes(offPick).includes('DOUBLE_FALLBACK'));
});

test('lambda tăiat la plafon e notă, nu penalizare — susține piața de goluri', () => {
  const f = classifyFallback({ elitul: { dixon_coles: { data_sufficiency: {
    homeIsFallback: false, awayIsFallback: false, homeHighLambdaLegitimate: true,
    sampleSize: { home: 90, away: 90 },
  } } } });
  assert.equal(sev(f, 'LAMBDA_CAPPED'), 'note');
  assert.ok(f.every((x) => x.severity !== 'exclude'));
});

test('eșantion mic degradează', () => {
  const f = classifyFallback({ elitul: { dixon_coles: { data_sufficiency: {
    homeIsFallback: false, awayIsFallback: false, sampleSize: { home: 12, away: 90 },
  } } } });
  // Măsurat: +2.0pp, adică nu discriminează. Rămâne informativ.
  assert.equal(sev(f, 'SMALL_SAMPLE'), 'note');
  assert.equal(f.find((x) => x.code === 'SMALL_SAMPLE').meta.sample, 12);
});

test('classifyFallback nu cade pe date lipsă', () => {
  assert.deepEqual(classifyFallback(null), []);
  assert.deepEqual(classifyFallback({}), []);
});

test('formSummary agregă corect', () => {
  const s = formSummary([
    { result: 'W' }, { result: 'W' }, { result: 'D' }, { result: 'L' }, { result: 'L' },
  ]);
  assert.equal(s.wins, 2);
  assert.equal(s.draws, 1);
  assert.equal(s.losses, 2);
  assert.equal(s.points, 7);
  assert.equal(s.sequence, 'WWDLL');
  assert.equal(formSummary([]), null);
});

test('veto de formă: 1 victorie în 5 exclude, oricât de tare ar fi consensul', () => {
  // Cazul Liverpool din instrucțiuni: D-D-L-D-L, model îl dă mare favorit.
  const context = { home_form: [
    { result: 'D' }, { result: 'D' }, { result: 'L' }, { result: 'D' }, { result: 'L' },
  ] };
  const f = formVeto(context, 'home');
  // Recalibrat pe 912 meciuri: efectul e real dar mic (−4.7pp), deci degradare,
  // nu excludere — pick-urile astea ies totuși mai des decât cele RISKY.
  assert.equal(sev(f, 'POOR_FORM_PICK'), 'downgrade');
  assert.match(f[0].message, /0 victorii/);
});

test('veto de formă: formă bună trece curat', () => {
  const context = { home_form: [
    { result: 'W' }, { result: 'W' }, { result: 'W' }, { result: 'D' }, { result: 'W' },
  ] };
  assert.deepEqual(formVeto(context, 'home'), []);
});

test('veto de formă: formă mediocră degradează, nu exclude', () => {
  // 2 victorii (trece de vetoul dur) dar doar 6/18 puncte ⇒ degradare.
  const context = { away_form: [
    { result: 'W' }, { result: 'W' }, { result: 'L' }, { result: 'L' }, { result: 'L' }, { result: 'L' },
  ] };
  const f = formVeto(context, 'away');
  assert.equal(sev(f, 'WEAK_FORM_PICK'), 'downgrade');
  assert.ok(!f.some((x) => x.severity === 'exclude'));
});

test('veto de formă: fără date ⇒ downgrade, nu trecere liberă', () => {
  assert.equal(sev(formVeto({}, 'home'), 'NO_FORM_DATA'), 'downgrade');
  assert.deepEqual(formVeto({}, 'draw'), [], 'egalul nu are „echipă aleasă"');
});

test('rundele de calificare europene se exclud, fazele principale nu', () => {
  assert.equal(sev(competitionFilter({ league_name: 'Conference League', round: 'Qualifying Round 2' }), 'QUALIFYING_ROUND'), 'exclude');
  assert.deepEqual(competitionFilter({ league_name: 'Conference League', round: 'Playoff' }), []);
  assert.deepEqual(competitionFilter({ league_name: 'Premier League' }), []);
  assert.deepEqual(competitionFilter({ league_name: 'Liga I', round: '3rd round' }), [], 'doar cupele europene');
});

test('consens 100% contrazis de piață ⇒ posibil bug de calibrare', () => {
  const consensus = { available: true, agreement_pct: 100, consensus: '1' };
  // Piața îl vede pe „2" clar favorit.
  const f = consensusVsMarket(consensus, [0.25, 0.25, 0.50]);
  // Cel mai puternic semnal măsurat (−32.3pp) ⇒ excludere, nu degradare.
  assert.equal(sev(f, 'CONSENSUS_VS_MARKET'), 'exclude');
  assert.match(f[0].message, /piața are dreptate/);
});

test('consens 100% în acord cu piața nu ridică flag', () => {
  const consensus = { available: true, agreement_pct: 100, consensus: '1' };
  assert.deepEqual(consensusVsMarket(consensus, [0.60, 0.25, 0.15]), []);
  assert.deepEqual(consensusVsMarket({ available: true, agreement_pct: 75, consensus: '1' }, [0.2, 0.2, 0.6]), [],
    'sub 100% nu e „STRONG contrazis"');
  assert.deepEqual(consensusVsMarket(consensus, null), [], 'fără cote nu se poate compara');
});

test('granularMarkets alege partea corectă față de baseline-ul ligii', () => {
  const g = { prediction_summary: { markets: [
    { market: 'over_2_5', value_pct: 40, league_baseline_pct: 54.9, sample_size: 20 },
    { market: 'btts', value_pct: 45, league_baseline_pct: 53.4, sample_size: 20 },
  ] } };
  const m = granularMarkets(g);
  const ou = m.find((x) => x.market === 'over_under');
  // 40% sub baseline 54.9% ⇒ partea „Under".
  assert.equal(ou.selection, 'Under 2.5');
  assert.equal(ou.granular_pct, 60);
  assert.ok(Math.abs(ou.delta_vs_baseline - 14.9) < 0.05);
});

test('granularMarkets ignoră eșantioane mici și diferențe nesemnificative', () => {
  assert.deepEqual(granularMarkets({ prediction_summary: { markets: [
    { market: 'over_2_5', value_pct: 80, league_baseline_pct: 50, sample_size: 3 },
  ] } }), [], 'eșantion sub prag');
  assert.deepEqual(granularMarkets({ prediction_summary: { markets: [
    { market: 'over_2_5', value_pct: 53, league_baseline_pct: 50, sample_size: 20 },
  ] } }), [], 'delta sub prag');
  assert.deepEqual(granularMarkets(null), []);
});

test('tierFor: exclude bate orice', () => {
  assert.equal(tierFor({ flags: [{ severity: 'exclude' }], probPct: 95, edgePct: 30 }), 'EXCLUDED');
});

test('tierFor: SAFE cere încredere și zero degradări', () => {
  assert.equal(tierFor({ flags: [], probPct: 70, edgePct: 5 }), 'SAFE');
  assert.equal(tierFor({ flags: [], probPct: 60 }), 'SAFE');
  assert.equal(tierFor({ flags: [{ severity: 'downgrade' }], probPct: 70 }), 'MODERATE');
  assert.equal(tierFor({ flags: [{ severity: 'downgrade' }, { severity: 'downgrade' }], probPct: 70 }), 'RISKY');
  assert.equal(tierFor({ flags: [], probPct: 52 }), 'RISKY');
});

test('safetyScore penalizează flag-urile și premiază consensul', () => {
  const base = { probPct: 65, consensus: { available: true, agreement_pct: 100, signal: 'STRONG' }, flags: [] };
  const clean = safetyScore(base);
  const flagged = safetyScore({ ...base, flags: [{ severity: 'downgrade' }] });
  assert.ok(clean > flagged, `${clean} vs ${flagged}`);
  assert.equal(safetyScore({ ...base, flags: [{ severity: 'exclude' }] }), 0);
  assert.ok(safetyScore(base) <= 100 && safetyScore(base) >= 0);
});

// ---- construirea biletelor ----

const cand = (slug, tier, score, prob, odds) => ({
  slug, tier, score, excluded: false,
  match: { home: slug, away: 'X', league: 'L', kickoff: '2026-09-21T18:00:00Z' },
  pick: { market: '1x2', selection: '1', prob_pct: prob, odds, edge_pct: 5 },
  support: { consensus: { available: true, models_for: 4, models_count: 4, signal: 'STRONG' } },
  flags: [],
});

test('buildSlips face două bilete de 3 legs, ordonate după scor', () => {
  const cs = Array.from({ length: 6 }, (_, i) => cand(`m${i}`, 'SAFE', 90 - i, 70, 1.5));
  const { slips } = buildSlips(cs);
  assert.equal(slips.length, 2);
  assert.equal(slips[0].legs.length, 3);
  assert.equal(slips[0].stake_ron, 50);
  assert.deepEqual(slips[0].legs.map((l) => l.slug), ['m0', 'm1', 'm2']);
  // 0.7^3 = 34.3%
  assert.ok(Math.abs(slips[0].combined_prob_pct - 34.3) < 0.2);
  assert.equal(slips[0].combined_odds, 3.38, '1.5^3 rotunjit');
  // Cifrele de pe bilet trebuie să fie consistente între ele.
  assert.equal(slips[0].potential_return_ron, 169);
  assert.equal(slips[0].potential_return_ron, slips[0].combined_odds * slips[0].stake_ron);
});

test('buildSlips nu forțează un bilet incomplet', () => {
  const { slips, incomplete } = buildSlips([cand('a', 'SAFE', 90, 70, 2), cand('b', 'SAFE', 89, 70, 2)]);
  assert.equal(slips.length, 0);
  assert.match(incomplete, /Nu forțez leguri slabe/);
});

test('buildSlips exclude tier-urile sub prag și meciurile excluse', () => {
  const cs = [
    cand('a', 'SAFE', 90, 70, 2), cand('b', 'MODERATE', 80, 65, 2),
    cand('c', 'RISKY', 70, 60, 2), cand('d', 'SAFE', 85, 68, 2),
  ];
  cs.push({ ...cand('e', 'SAFE', 95, 70, 2), excluded: true });
  const { slips } = buildSlips(cs, { minTier: 'MODERATE' });
  assert.equal(slips.length, 1);
  assert.deepEqual(slips[0].legs.map((l) => l.slug), ['a', 'd', 'b']);
  assert.ok(!slips[0].legs.some((l) => l.slug === 'c'), 'RISKY exclus');
  assert.ok(!slips[0].legs.some((l) => l.slug === 'e'), 'exclus rămâne exclus');
});

test('buildSlips nu pune două leguri din același meci (sunt corelate)', () => {
  const cs = [
    cand('acelasi', 'SAFE', 95, 70, 2),
    { ...cand('acelasi', 'SAFE', 94, 70, 2), pick: { market: 'over_under', selection: 'Over 2.5', prob_pct: 70, odds: 1.8 } },
    cand('alt1', 'SAFE', 90, 70, 2), cand('alt2', 'SAFE', 89, 70, 2),
  ];
  const { slips } = buildSlips(cs);
  assert.equal(slips.length, 1);
  assert.equal(new Set(slips[0].legs.map((l) => l.slug)).size, 3);
});

test('buildSlips raportează când lipsesc cotele', () => {
  const cs = Array.from({ length: 3 }, (_, i) => cand(`m${i}`, 'SAFE', 90 - i, 70, null));
  const { slips } = buildSlips(cs);
  assert.equal(slips[0].all_legs_have_odds, false);
  assert.equal(slips[0].combined_odds, null);
  assert.equal(slips[0].potential_return_ron, null);
  assert.ok(slips[0].combined_prob_pct > 0, 'probabilitatea se calculează oricum');
});

// ---- confirmarea din granular-stats pentru piețele alternative ----

test('o piață alternativă fără semnal granular pe piața ei rămâne neconfirmată', async () => {
  const { analyseMatch } = await import('../src/bot/betslips.js');
  const { readFileSync } = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/match-bundle.json', import.meta.url), 'utf8'));

  const realFetch = globalThis.fetch;
  const { limiter } = await import('../src/dataFetcher.js');
  limiter.blockedUntil = 0;
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/models')) return new Response(JSON.stringify(fixture.models), { status: 200 });
    if (p.endsWith('/context')) return new Response(JSON.stringify(fixture.context), { status: 200 });
    if (p.endsWith('/granular-stats')) {
      // Date doar pentru Over/Under — nimic pentru BTTS.
      return new Response(JSON.stringify({ prediction_summary: { markets: [
        { market: 'over_2_5', value_pct: 75, league_baseline_pct: 52, sample_size: 20 },
      ] } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    const r = await analyseMatch({
      slug: 'a-vs-b', home_team: 'A', away_team: 'B',
      league_name: 'Premier League', match_date: '2026-10-10T14:00:00Z',
      ensemble_prediction: '1',
    }, { simulations: 500 });

    if (r.pick && r.pick.market === 'btts') {
      const cs = r.flags.map((f) => f.code);
      assert.ok(
        cs.includes('NO_GRANULAR_FOR_MARKET') || cs.includes('GRANULAR_CONTRADICTS'),
        `pick BTTS fără confirmare granular trebuie flagat, flags: ${cs.join(',')}`
      );
    }
    // Pick-ul pe Over 2.5 e confirmat de granular ⇒ fără flag de neconfirmare.
    if (r.pick && r.pick.selection === 'Over 2.5') {
      assert.ok(!r.flags.some((f) => f.code === 'NO_GRANULAR_FOR_MARKET'));
      assert.ok(r.support.granular_aligned, 'alinierea trebuie raportată');
    }
    assert.ok(['SAFE', 'MODERATE', 'RISKY', 'EXCLUDED'].includes(r.tier));
  } finally { globalThis.fetch = realFetch; }
});

test('meciul fără ensemble_prediction e exclus înainte de orice fetch', async () => {
  const { analyseMatch } = await import('../src/bot/betslips.js');
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    const r = await analyseMatch({ slug: 'x', league_name: 'Liga I', ensemble_prediction: null });
    assert.equal(r.excluded, true);
    assert.equal(r.flags[0].code, 'NO_ENSEMBLE');
    assert.equal(called, false, 'nu se cheltuie cereri pe meciuri fără semnal');
  } finally { globalThis.fetch = realFetch; }
});

test('runda de calificare e exclusă fără fetch', async () => {
  const { analyseMatch } = await import('../src/bot/betslips.js');
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    const r = await analyseMatch({
      slug: 'x', league_name: 'Europa League', round: 'Qualifying Round 3', ensemble_prediction: '1',
    });
    assert.equal(r.excluded, true);
    assert.equal(r.flags[0].code, 'QUALIFYING_ROUND');
    assert.equal(called, false);
  } finally { globalThis.fetch = realFetch; }
});

// ---- granular reconstruit din istoric (fără leakage) ----

test('historicalGranular numără doar meciuri anterioare', async () => {
  const { historicalGranular, altMarketOutcome } = await import('../src/bot/historicalGranular.js');
  const hist = [];
  // A joacă 8 meciuri cu multe goluri, B 8 cu puține.
  for (let i = 0; i < 8; i++) {
    hist.push({ home: 'A', away: `X${i}`, homeGoals: 3, awayGoals: 2, date: `2026-01-${String(i + 1).padStart(2, '0')}` });
    hist.push({ home: 'B', away: `Y${i}`, homeGoals: 0, awayGoals: 1, date: `2026-01-${String(i + 1).padStart(2, '0')}` });
  }
  const g = historicalGranular(hist, 'A', 'B');
  const over = g.prediction_summary.markets.find((m) => m.market === 'over_2_5');
  // A: 8 meciuri cu 5 goluri (toate over), B: 8 cu 1 gol (niciunul) ⇒ 50%.
  assert.equal(over.value_pct, 50);
  assert.equal(over.sample_size, 16);
  // Baseline-ul ligii e tot 50% (jumătate din toate meciurile sunt over).
  assert.equal(over.league_baseline_pct, 50);
  assert.equal(g._meta.home_sample, 8);
});

test('historicalGranular refuză eșantioane prea mici', async () => {
  const { historicalGranular } = await import('../src/bot/historicalGranular.js');
  const hist = [{ home: 'A', away: 'B', homeGoals: 1, awayGoals: 1, date: '2026-01-01' }];
  assert.equal(historicalGranular(hist, 'A', 'B'), null);
});

test('historicalGranular se leagă de granularMarkets fără adaptor', async () => {
  const { historicalGranular } = await import('../src/bot/historicalGranular.js');
  const hist = [];
  for (let i = 0; i < 10; i++) {
    // Ambele echipe joacă meciuri cu multe goluri; liga în rest e seacă.
    hist.push({ home: 'A', away: 'B', homeGoals: 3, awayGoals: 2, date: `2026-01-${String(i + 1).padStart(2, '0')}` });
    for (let j = 0; j < 3; j++) {
      hist.push({ home: `C${j}`, away: `D${j}`, homeGoals: 0, awayGoals: 0, date: `2026-01-${String(i + 1).padStart(2, '0')}` });
    }
  }
  const g = historicalGranular(hist, 'A', 'B');
  const m = granularMarkets(g, { minSample: 10, minDelta: 10 });
  const over = m.find((x) => x.market === 'over_under');
  assert.equal(over.selection, 'Over 2.5', 'echipele sunt peste baseline-ul ligii');
  assert.ok(over.delta_vs_baseline > 50, `abatere mare față de o ligă seacă: ${over.delta_vs_baseline}`);
});

test('altMarketOutcome rezolvă corect fiecare piață', async () => {
  const { altMarketOutcome } = await import('../src/bot/historicalGranular.js');
  const m = (h, a) => ({ homeGoals: h, awayGoals: a });
  assert.equal(altMarketOutcome(m(2, 1), 'Over 2.5'), true);
  assert.equal(altMarketOutcome(m(1, 1), 'Over 2.5'), false);
  assert.equal(altMarketOutcome(m(1, 1), 'Under 2.5'), true);
  assert.equal(altMarketOutcome(m(1, 1), 'BTTS Yes'), true);
  assert.equal(altMarketOutcome(m(3, 0), 'BTTS Yes'), false);
  assert.equal(altMarketOutcome(m(3, 0), 'BTTS No'), true);
  assert.equal(altMarketOutcome(m(1, 1), 'Handicap'), null);
});

// ---- verificarea de realitate pe segmente de piață (măsurată, nu modelată) ----

test('bookmakerMargin calculează marja corect', async () => {
  const { bookmakerMargin } = await import('../src/bot/marketPrior.js');
  assert.ok(Math.abs(bookmakerMargin([3, 3, 3]) - 0) < 1e-9, 'piață fără marjă');
  assert.ok(bookmakerMargin([2.5, 3.2, 3.0]) > 0);
  assert.equal(bookmakerMargin([0.5, 3, 3]), null, 'cotă invalidă');
  assert.equal(bookmakerMargin(null), null);
});

test('marketPrior ia cea mai pesimistă estimare, nu media', async () => {
  const { marketPrior } = await import('../src/bot/marketPrior.js');
  // Cotă mică (−1.19%) dar poziție „oaspeți" (−11.19%), pe o piață cu marjă
  // normală (~5%, deci −6.58%) ⇒ poziția trebuie să domine.
  const r = marketPrior({ selection: '2', odds: 1.45, allOdds: [5.5, 5.5, 1.45] });
  assert.ok(r.margin_pct < 6, `marja trebuie să fie normală, e ${r.margin_pct}%`);
  assert.equal(r.driver, 'poziție', JSON.stringify(r.parts));
  assert.ok(r.expected_roi_pct <= -11, `${r.expected_roi_pct}`);
  assert.ok(r.parts.length >= 3);
});

test('marketPrior semnalează ligile slabe măsurate', async () => {
  const { marketPrior } = await import('../src/bot/marketPrior.js');
  const r = marketPrior({ selection: '1', odds: 1.4, allOdds: [1.4, 4.5, 7], league: '60' });
  assert.ok(r.parts.some((p) => p.source === 'ligă' && p.league === 'Ekstraklasa'));
  assert.ok(r.expected_roi_pct <= -11);
});

test('marketPrior funcționează cu date parțiale', async () => {
  const { marketPrior } = await import('../src/bot/marketPrior.js');
  assert.ok(marketPrior({ selection: '1' }).parts.length === 1);
  assert.equal(marketPrior({}), null);
});

test('isLeastBadCategory recunoaște doar favoritul scurt', async () => {
  const { isLeastBadCategory, oddsForSelection } = await import('../src/bot/marketPrior.js');
  assert.equal(isLeastBadCategory({ selection: '1', odds: 1.4, allOdds: [1.4, 4.5, 7] }), true);
  assert.equal(isLeastBadCategory({ selection: '1', odds: 1.8, allOdds: [1.8, 3.5, 4] }), false, 'peste 1.60');
  assert.equal(isLeastBadCategory({ selection: '2', odds: 1.4, allOdds: [1.4, 4.5, 7] }), false,
    'selecția „2" are cota 7, nu 1.4 — cota se derivă din selecție');
  assert.equal(isLeastBadCategory({ selection: 'X', odds: 1.4, allOdds: [1.4, 4.5, 7] }), false, 'egalul nu intră');
});

test('oddsForSelection derivă cota din selecție, nu o crede pe cuvânt', async () => {
  const { oddsForSelection } = await import('../src/bot/marketPrior.js');
  const all = [1.4, 4.5, 7];
  assert.equal(oddsForSelection('1', 999, all), 1.4, 'setul complet are prioritate');
  assert.equal(oddsForSelection('X', 999, all), 4.5);
  assert.equal(oddsForSelection('2', 999, all), 7);
  assert.equal(oddsForSelection('1', 1.4, null), 1.4, 'fără set complet, foloseşte cota dată');
  assert.equal(oddsForSelection('Over 2.5', null, all), null, 'piață necunoscută');
});

test('marketRealityCheck degradează segmentele slabe', async () => {
  const { marketRealityCheck } = await import('../src/bot/screening.js');
  // Pariu pe oaspeți la cotă mare, marjă mare, ligă slabă — tot ce e prost.
  const f = marketRealityCheck({ selection: '2', odds: 6.5, allOdds: [1.35, 5.0, 6.5], league: '60' });
  const cs = f.map((x) => x.code);
  assert.ok(cs.includes('BAD_MARKET_SEGMENT'));
  assert.equal(f.find((x) => x.code === 'BAD_MARKET_SEGMENT').severity, 'downgrade');
});

test('marketRealityCheck semnalează marja mare separat', async () => {
  const { marketRealityCheck } = await import('../src/bot/screening.js');
  // Marjă ~14%, dar pariu pe favorit scurt.
  const f = marketRealityCheck({ selection: '1', odds: 1.45, allOdds: [1.45, 4.2, 5.5] });
  const hm = f.find((x) => x.code === 'HIGH_MARGIN');
  assert.ok(hm, `marjă mare trebuie semnalată: ${JSON.stringify(f.map((x) => x.code))}`);
  assert.match(hm.message, /alt bookmaker/);
});

test('marketRealityCheck marchează categoria cea mai bună măsurată', async () => {
  const { marketRealityCheck } = await import('../src/bot/screening.js');
  // Favorit scurt, marjă mică, ligă neutră.
  const f = marketRealityCheck({ selection: '1', odds: 1.45, allOdds: [1.45, 4.8, 7.5], league: 'PL' });
  const best = f.find((x) => x.code === 'BEST_MEASURED_CATEGORY');
  assert.ok(best);
  assert.equal(best.severity, 'note', 'informativ — nu e profit, e pierdere minimă');
  assert.match(best.message, /Nu e profit/);
});

test('marketRealityCheck nu inventează flag-uri fără date', async () => {
  const { marketRealityCheck } = await import('../src/bot/screening.js');
  assert.deepEqual(marketRealityCheck({}), []);
});
