import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFixtures, normalizeTeam, joinKey, XG_SEASONS } from '../src/lib/xgData.js';

const close = (a, b, eps = 0.001) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const player = (o) => ({
  fixture: '6', kickoff_time: '2024-08-17T14:00:00Z', round: '1',
  team_h_score: '1', team_a_score: '1', ...o,
});

test('aggregateFixtures însumează xG-ul jucătorilor pe echipă', () => {
  const rows = [
    player({ team: 'Arsenal', was_home: 'True', expected_goals: '0.42' }),
    player({ team: 'Arsenal', was_home: 'True', expected_goals: '0.31' }),
    player({ team: 'Bournemouth', was_home: 'False', expected_goals: '0.10' }),
    player({ team: 'Bournemouth', was_home: 'False', expected_goals: '0.25' }),
  ];
  const [f] = aggregateFixtures(rows, '2024-25');
  assert.equal(f.home, 'Arsenal');
  assert.equal(f.away, 'Bournemouth');
  close(f.xgHome, 0.73);
  close(f.xgAway, 0.35);
  assert.equal(f.outcome, 'X');
  assert.equal(f.date, '2024-08-17');
});

test('aggregateFixtures separă meciurile după fixture', () => {
  const rows = [
    player({ fixture: '1', team: 'A', was_home: 'True', expected_goals: '1.0', team_h_score: '2', team_a_score: '0' }),
    player({ fixture: '1', team: 'B', was_home: 'False', expected_goals: '0.5', team_h_score: '2', team_a_score: '0' }),
    player({ fixture: '2', team: 'C', was_home: 'True', expected_goals: '0.2', team_h_score: '0', team_a_score: '3' }),
    player({ fixture: '2', team: 'D', was_home: 'False', expected_goals: '2.1', team_h_score: '0', team_a_score: '3' }),
  ];
  const out = aggregateFixtures(rows, '2024-25');
  assert.equal(out.length, 2);
  assert.equal(out.find((f) => f.fixture === '1').outcome, '1');
  assert.equal(out.find((f) => f.fixture === '2').outcome, '2');
});

test('aggregateFixtures ignoră rândurile fără xG numeric', () => {
  const rows = [
    player({ team: 'A', was_home: 'True', expected_goals: '' }),
    player({ team: 'A', was_home: 'True', expected_goals: '0.5' }),
    player({ team: 'B', was_home: 'False', expected_goals: 'n/a' }),
    player({ team: 'B', was_home: 'False', expected_goals: '0.2' }),
  ];
  const [f] = aggregateFixtures(rows, '2024-25');
  close(f.xgHome, 0.5);
  close(f.xgAway, 0.2);
});

test('aggregateFixtures elimină meciurile incomplete', () => {
  // Doar o echipă prezentă ⇒ nu e un meci valid.
  const rows = [player({ team: 'A', was_home: 'True', expected_goals: '1.0' })];
  assert.deepEqual(aggregateFixtures(rows, '2024-25'), []);
});

test('aggregateFixtures întoarce meciurile cronologic', () => {
  const rows = [
    player({ fixture: '2', kickoff_time: '2024-09-01T14:00:00Z', team: 'C', was_home: 'True', expected_goals: '1' }),
    player({ fixture: '2', kickoff_time: '2024-09-01T14:00:00Z', team: 'D', was_home: 'False', expected_goals: '1' }),
    player({ fixture: '1', kickoff_time: '2024-08-17T14:00:00Z', team: 'A', was_home: 'True', expected_goals: '1' }),
    player({ fixture: '1', kickoff_time: '2024-08-17T14:00:00Z', team: 'B', was_home: 'False', expected_goals: '1' }),
  ];
  const out = aggregateFixtures(rows, '2024-25');
  assert.deepEqual(out.map((f) => f.date), ['2024-08-17', '2024-09-01']);
});

test('normalizeTeam face puntea între denumirile FPL și football-data', () => {
  assert.equal(normalizeTeam('Man Utd'), 'Man United');
  assert.equal(normalizeTeam('Spurs'), 'Tottenham');
  assert.equal(normalizeTeam('Nottingham Forest'), "Nott'm Forest");
  assert.equal(normalizeTeam('Arsenal'), 'Arsenal', 'numele identice trec neschimbate');
  assert.equal(normalizeTeam(null), null);
});

test('joinKey e stabilă și distinge gazdele de oaspeți', () => {
  assert.equal(joinKey('2024-08-17', 'Man Utd', 'Arsenal'), '2024-08-17|Man United|Arsenal');
  assert.notEqual(
    joinKey('2024-08-17', 'Arsenal', 'Man Utd'),
    joinKey('2024-08-17', 'Man Utd', 'Arsenal'),
    'inversarea echipelor e alt meci'
  );
});

test('sezoanele cu xG încep din 2022-23', () => {
  assert.ok(XG_SEASONS.includes('2022-23'));
  assert.ok(!XG_SEASONS.includes('2021-22'), 'FPL n-avea xG înainte');
});
