import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBot, buildModelSources, buildCandidates, selectPick } from '../src/bot/botLogic.js';
import { personalities, getPersonality, formStats, shift1x2 } from '../src/bot/personalities.js';
import { buildReasoning } from '../src/bot/reasoning.js';

const bundle = JSON.parse(readFileSync(new URL('./fixtures/match-bundle.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(bundle));

test('buildModelSources reconstruiește toate modelele din payload-ul API', () => {
  const { sources, detail } = buildModelSources(bundle.models, { simulations: 2000 });
  assert.deepEqual(Object.keys(sources).sort(), ['dixonColes', 'elo', 'monteCarlo', 'poisson', 'predictcamp']);
  assert.ok(detail.dixon_coles.lambda_home > 2.7 && detail.dixon_coles.lambda_home < 2.72);
  assert.equal(detail.monte_carlo.simulations, 2000);
  assert.ok(detail.elo.diff === 245);
  for (const s of Object.values(sources)) {
    assert.ok(Math.abs(s.home_win + s.draw + s.away_win - 1) < 1e-6);
  }
});

test('buildModelSources tolerează modele lipsă', () => {
  const { sources } = buildModelSources({ elo: { home_rating: 1600, away_rating: 1500 } });
  assert.deepEqual(Object.keys(sources), ['elo']);
  assert.deepEqual(Object.keys(buildModelSources({}).sources), []);
});

test('runBot produce o predicție completă fără cote', () => {
  const r = runBot(clone(), { personalityId: 'ai-analyst', simulations: 3000 });
  assert.equal(r.bot.id, 'ai-analyst');
  assert.equal(r.selection, '1', 'Rangers e favorit clar în fixture');
  assert.ok(r.confidence > 55);
  assert.equal(r.edge_pct, null, 'fără cote nu există edge');
  assert.equal(r.kelly_stake, null);
  assert.ok(r.reasoning.summary.length > 20);
  assert.ok(r.reasoning.bullets.length >= 4);
  assert.ok(Math.abs(r.probabilities.home_win_pct + r.probabilities.draw_pct + r.probabilities.away_win_pct - 100) < 0.2);
});

test('runBot calculează edge, EV și Kelly când primește cote', () => {
  // Cotele implică ~48% pentru gazde; modelul dă ~65% ⇒ edge pozitiv mare.
  const r = runBot(clone(), { personalityId: 'ai-analyst', odds: { '1x2': [2.10, 3.40, 3.60] }, simulations: 3000 });
  assert.equal(r.selection, '1');
  assert.ok(r.edge_pct > 5, `edge ${r.edge_pct}`);
  assert.ok(r.ev_percent > 0);
  assert.ok(r.kelly_stake > 0 && r.kelly_stake <= 0.05, `stake ${r.kelly_stake}`);
  assert.ok(r.reasoning.bullets.some((b) => b.includes('de-vig')));
});

test('runBot alege NO BET când cotele nu lasă edge', () => {
  // Cotă 1.30 pentru gazde ⇒ piața cere ~75%, modelul dă ~65%.
  const r = runBot(clone(), { personalityId: 'statisticianul', odds: { '1x2': [1.30, 5.5, 9.0] }, simulations: 2000 });
  assert.equal(r.selection, null);
  assert.equal(r.prediction, 'NO BET');
  assert.ok(r.no_bet_reason.includes('praguri'));
  assert.ok(r.reasoning.summary.includes('Nu pariez'));
});

test('personalitățile diferă între ele pe același meci', () => {
  const results = Object.keys(personalities).map((id) =>
    runBot(clone(), { personalityId: id, odds: { '1x2': [2.10, 3.40, 3.60] }, simulations: 2000 })
  );
  const probs = results.map((r) => r.probabilities.home_win_pct);
  assert.ok(new Set(probs).size > 1, 'ajustările de context trebuie să producă probabilități diferite');
  const picks = results.map((r) => r.selection);
  assert.ok(new Set(picks).size > 1, 'personalitățile nu trebuie să copieze aceeași selecție');
  // Underdog Lover nu are voie să aleagă favoritul pe 1X2.
  const underdog = results.find((r) => r.bot.id === 'underdog-lover');
  assert.notEqual(underdog.selection, '1');
});

test('Value Hunter refuză să parieze fără cote', () => {
  const r = runBot(clone(), { personalityId: 'value-hunter', simulations: 1000 });
  assert.equal(r.selection, null);
  assert.ok(r.no_bet_reason.includes('cote'));
});

test('Istoricul deplasează probabilitățile spre H2H', () => {
  const base = runBot(clone(), { personalityId: 'matematicianul', simulations: 1000 });
  const hist = runBot(clone(), { personalityId: 'istoricul', simulations: 1000 });
  // H2H e 8-0-2 pentru gazde (80%), peste probabilitatea de model ⇒ împinge în sus.
  assert.ok(hist.probabilities.home_win_pct > hist.pre_adjustment.home_win_pct);
  assert.notEqual(base.probabilities.home_win_pct, hist.probabilities.home_win_pct);
});

test('Forma Zilei reacționează la diferența de formă', () => {
  const r = runBot(clone(), { personalityId: 'forma-zilei', simulations: 1000 });
  // Gazdele au 15/15 puncte, oaspeții 5/15 ⇒ ajustare pozitivă pentru gazde.
  assert.ok(r.probabilities.home_win_pct > r.pre_adjustment.home_win_pct);
});

test('runBot aruncă dacă nu există niciun model', () => {
  assert.throws(() => runBot({ slug: 'x', models: {} }), /niciun model/);
});

test('getPersonality validează id-ul', () => {
  assert.equal(getPersonality('ai-analyst').id, 'ai-analyst');
  assert.throws(() => getPersonality('inexistent'), /necunoscută/);
});

test('formStats agregă corect forma', () => {
  const s = formStats(bundle.context.home_form);
  assert.equal(s.matches, 5);
  assert.equal(s.points, 15);
  assert.equal(s.max_points, 15);
  assert.equal(formStats([]), null);
});

test('shift1x2 păstrează suma 1 și nu produce probabilități negative', () => {
  const r = shift1x2({ home_win: 0.5, draw: 0.3, away_win: 0.2 }, { home: -0.9, away: 0.4 });
  assert.ok(Math.abs(r.home_win + r.draw + r.away_win - 1) < 1e-9);
  assert.ok(r.home_win > 0 && r.away_win > 0);
});

test('buildCandidates produce piețele cerute de politică', () => {
  const p = getPersonality('ai-analyst');
  const c = buildCandidates({
    probs: { home_win: 0.6, draw: 0.25, away_win: 0.15 },
    secondary: { over25: 0.7, btts_yes: 0.55 },
    personality: p,
  });
  assert.deepEqual([...new Set(c.map((x) => x.market))], ['1x2', 'over_under', 'btts']);
  assert.equal(c.length, 7);
  assert.ok(c.every((x) => x.edge_pct === undefined), 'fără cote nu se calculează edge');
});

test('buildCandidates ignoră cote cu lungime greșită', () => {
  const c = buildCandidates({
    probs: { home_win: 0.6, draw: 0.25, away_win: 0.15 },
    secondary: {},
    odds: { '1x2': [2.0, 3.0] },
    personality: getPersonality('matematicianul'),
  });
  assert.ok(c.every((x) => x.book_odds === undefined));
});

test('selectPick respectă pragul de încredere', () => {
  const p = getPersonality('statisticianul'); // minConfidence 58
  const candidates = [
    { market: '1x2', selection: '1', label: 'Gazde', model_prob: 0.55, model_prob_pct: 55 },
    { market: '1x2', selection: 'X', label: 'Egal', model_prob: 0.25, model_prob_pct: 25 },
  ];
  assert.equal(selectPick(candidates, p, { hasOdds: false }).pick, null);
  candidates[0].model_prob_pct = 62;
  assert.equal(selectPick(candidates, p, { hasOdds: false }).pick.selection, '1');
});

test('selectPick exclude egalul pentru Statisticianul', () => {
  const p = getPersonality('statisticianul');
  const candidates = [{ market: '1x2', selection: 'X', label: 'Egal', model_prob: 0.9, model_prob_pct: 90 }];
  assert.equal(selectPick(candidates, p, { hasOdds: false }).pick, null);
});

test('buildReasoning produce text fără pariu', () => {
  const analysis = { models_detail: {}, models_consensus: { available: false } };
  const r = buildReasoning({
    analysis, pick: null, personality: getPersonality('value-hunter'),
    context: null, reasonNoBet: 'fără cote',
  });
  assert.ok(r.summary.includes('Nu pariez'));
  assert.equal(r.voice, 'value');
});
