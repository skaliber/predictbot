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
