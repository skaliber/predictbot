import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseDate, normalizeRow } from '../src/lib/footballData.js';

test('parseCsv gestionează antetul cu BOM și rândurile cu ghilimele', () => {
  const csv = '﻿Div,HomeTeam,AwayTeam,Note\nE0,Arsenal,"Leeds, United",ok\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Div, 'E0', 'BOM-ul trebuie eliminat din primul nume de coloană');
  assert.equal(rows[0].AwayTeam, 'Leeds, United', 'virgula din ghilimele nu separă');
});

test('parseCsv pe fișier gol sau doar antet', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('A,B\n'), []);
});

test('parseDate acceptă ambele formate de an', () => {
  assert.equal(parseDate('20/07/2012'), '2012-07-20');
  assert.equal(parseDate('05/01/25'), '2025-01-05');
  assert.equal(parseDate('2012-07-20'), null, 'formatul ISO nu e cel din sursă');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(undefined), null);
});

test('normalizeRow preferă cotele Pinnacle de închidere', () => {
  const r = normalizeRow({
    Date: '20/07/2012', Home: 'A', Away: 'B', HG: '2', AG: '1',
    PSCH: '1.51', PSCD: '4.24', PSCA: '7.59',
    AvgCH: '1.47', AvgCD: '3.85', AvgCA: '6.43',
  }, { league: 'ROU' });
  assert.equal(r.closingSource, 'pinnacle');
  assert.deepEqual(r.closingOdds, [1.51, 4.24, 7.59]);
  assert.equal(r.outcome, '1');
  assert.equal(r.goals, 3);
  assert.equal(r.date, '2012-07-20');
});

test('normalizeRow cade pe media pieței când Pinnacle lipsește', () => {
  const r = normalizeRow({
    Date: '12/09/2026', Home: 'A', Away: 'B', HG: '2', AG: '1',
    AvgCH: '1.39', AvgCD: '4.19', AvgCA: '6.93',
  }, { league: 'ROU' });
  assert.equal(r.closingSource, 'market_avg');
  assert.deepEqual(r.closingOdds, [1.39, 4.19, 6.93]);
});

test('normalizeRow nu acceptă un set parțial de cote', () => {
  const r = normalizeRow({
    Date: '12/09/2026', Home: 'A', Away: 'B', HG: '0', AG: '0',
    PSCH: '1.5', PSCD: '4.0', // lipsește PSCA
  }, { league: 'X' });
  assert.equal(r.closingOdds, null, 'un set incomplet nu se folosește');
  assert.equal(r.outcome, 'X');
});

test('normalizeRow citește Over/Under 2.5 de închidere', () => {
  const r = normalizeRow({
    Date: '01/01/2025', HomeTeam: 'A', AwayTeam: 'B', FTHG: '3', FTAG: '1',
    'PC>2.5': '1.85', 'PC<2.5': '2.05',
  }, { league: 'E0' });
  assert.equal(r.ouClosingSource, 'pinnacle');
  assert.deepEqual(r.ouClosingOdds, [1.85, 2.05]);
  assert.equal(r.goals, 4);
});

test('normalizeRow respinge rândurile fără rezultat sau dată', () => {
  assert.equal(normalizeRow({ Date: '', HG: '1', AG: '0' }, {}), null);
  assert.equal(normalizeRow({ Date: '01/01/2025', HG: '', AG: '' }, {}), null);
  assert.equal(normalizeRow({ Date: '01/01/2025', HG: 'x', AG: '0' }, {}), null);
});

test('normalizeRow acceptă ambele scheme de nume de coloană', () => {
  // Ligile principale folosesc FTHG/HomeTeam, cele suplimentare HG/Home.
  const main = normalizeRow({ Date: '01/01/2025', HomeTeam: 'A', AwayTeam: 'B', FTHG: '1', FTAG: '1' }, { league: 'E0' });
  const extra = normalizeRow({ Date: '01/01/2025', Home: 'A', Away: 'B', HG: '1', AG: '1' }, { league: 'ROU' });
  assert.equal(main.home, 'A');
  assert.equal(extra.home, 'A');
  assert.equal(main.outcome, extra.outcome);
});

test('normalizeRow citește linia și cotele Asian Handicap', () => {
  const r = normalizeRow({
    Date: '16/08/2024', HomeTeam: 'A', AwayTeam: 'B', FTHG: '1', FTAG: '0',
    AHh: '-0.75', PAHH: '1.95', PAHA: '1.97',
    AHCh: '-0.5', PCAHH: '1.88', PCAHA: '2.04',
  }, { league: 'E0' });
  assert.equal(r.ahLineOpen, -0.75);
  assert.equal(r.ahLineClose, -0.5);
  assert.deepEqual(r.ahOpeningOdds, [1.95, 1.97]);
  assert.deepEqual(r.ahClosingOdds, [1.88, 2.04]);
});

test('normalizeRow acceptă handicapul zero, care e o valoare validă', () => {
  const r = normalizeRow({
    Date: '16/08/2024', HomeTeam: 'A', AwayTeam: 'B', FTHG: '1', FTAG: '1',
    AHh: '0', PAHH: '2.0', PAHA: '1.9',
  }, { league: 'E0' });
  assert.equal(r.ahLineOpen, 0, 'DNB e linie validă, nu „lipsă"');
  assert.deepEqual(r.ahOpeningOdds, [2.0, 1.9]);
});

test('normalizeRow derivă BTTS din scor', () => {
  const yes = normalizeRow({ Date: '01/01/2025', HomeTeam: 'A', AwayTeam: 'B', FTHG: '2', FTAG: '1' }, {});
  const no = normalizeRow({ Date: '01/01/2025', HomeTeam: 'A', AwayTeam: 'B', FTHG: '3', FTAG: '0' }, {});
  const nil = normalizeRow({ Date: '01/01/2025', HomeTeam: 'A', AwayTeam: 'B', FTHG: '0', FTAG: '0' }, {});
  assert.equal(yes.btts, true);
  assert.equal(no.btts, false);
  assert.equal(nil.btts, false);
});

test('cheia de cache include versiunea schemei', async () => {
  // Regresie: adăugarea cotelor AH a fost servită tăcut din cache-ul vechi,
  // iar câmpurile apăreau undefined — arătând ca „sursa nu le are".
  const { SCHEMA_VERSION } = await import('../src/lib/footballData.js');
  assert.ok(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 2);
  const src = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../src/lib/footballData.js', import.meta.url), 'utf8'));
  assert.ok(/cached\(\[\s*'fd',\s*`v\$\{SCHEMA_VERSION\}`/.test(src),
    'cheile de cache trebuie să conțină versiunea schemei');
});

test('normalizeRow păstrează cotele fiecărei case separat', () => {
  const r = normalizeRow({
    Date: '16/08/2024', HomeTeam: 'A', AwayTeam: 'B', FTHG: '1', FTAG: '0',
    B365H: '2.10', B365D: '3.40', B365A: '3.50',
    B365CH: '2.05', B365CD: '3.50', B365CA: '3.60',
    PSH: '2.12', PSD: '3.45', PSA: '3.55',
    PSCH: '2.08', PSCD: '3.55', PSCA: '3.65',
    MaxCH: '2.20', MaxCD: '3.70', MaxCA: '3.80',
  }, { league: 'E0' });
  assert.deepEqual(r.books.b365.open, [2.10, 3.40, 3.50]);
  assert.deepEqual(r.books.b365.close, [2.05, 3.50, 3.60]);
  assert.deepEqual(r.books.pinnacle.close, [2.08, 3.55, 3.65]);
  assert.deepEqual(r.books.market_max.close, [2.20, 3.70, 3.80]);
  assert.equal(r.books.market_avg.close, null, 'casă fără cote ⇒ null, nu set parțial');
});

test('versiunea schemei a crescut după adăugarea cotelor per casă', async () => {
  const { SCHEMA_VERSION } = await import('../src/lib/footballData.js');
  assert.ok(SCHEMA_VERSION >= 3, 'fără incrementare, cache-ul vechi ar servi rânduri fără `books`');
});
