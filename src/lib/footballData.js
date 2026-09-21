/**
 * Ingestor pentru football-data.co.uk — singura sursă gratuită cu **cote de
 * închidere** reale (Pinnacle), care e reperul profesionist.
 *
 * Cotele din PredictCamp sunt un singur instantaneu, fără garanția că sunt
 * de închidere. Fără cote de închidere, orice studiu de edge e invalid:
 * compari cu un preț care s-ar fi putut mișca.
 *
 * Două formate:
 *   mmz4281/<sezon>/<cod>.csv  — ligile principale, cu Over/Under 2.5
 *   new/<TARA>.csv             — ligi suplimentare, 1X2 pe mai multe sezoane
 */
import { cached } from './cache.js';
import log from './log.js';

const BASE = 'https://www.football-data.co.uk';

/**
 * Versiunea schemei de normalizare. INTRĂ ÎN CHEIA DE CACHE.
 *
 * Fără ea, adăugarea unui câmp nou în `normalizeRow` (ex. cotele AH) e servită
 * tăcut din cache-ul vechi, iar câmpul apare `undefined` peste tot — ceea ce
 * arată ca „sursa nu are datele", nu ca o eroare. Crește-o la orice schimbare
 * de formă a rândului.
 */
const SCHEMA_VERSION = 2;

/** CSV minimal: câmpuri între ghilimele, virgulă ca separator. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  // BOM-ul de la începutul fișierului strică primul nume de coloană.
  const header = split(lines[0]).map((h) => h.replace(/^﻿/, '').trim());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Datele vin ca DD/MM/YYYY sau DD/MM/YY. */
export function parseDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s ?? '');
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  return `${year}-${mo}-${d}`;
}

/**
 * Normalizează un rând la forma folosită de restul codului.
 * Preferă cotele de ÎNCHIDERE: Pinnacle (PSC*), apoi media pieței (AvgC*),
 * apoi Bet365 (B365C*). Cotele de deschidere sunt doar diagnostic.
 */
/** Number('') e 0 — un meci fără rezultat ar deveni tăcut 0-0. */
const goals = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function normalizeRow(r, { league, country }) {
  const date = parseDate(r.Date);
  const hg = goals(r.FTHG ?? r.HG);
  const ag = goals(r.FTAG ?? r.AG);
  if (!date || hg === null || ag === null) return null;

  const closing = [
    { src: 'pinnacle', o: [num(r.PSCH), num(r.PSCD), num(r.PSCA)] },
    { src: 'market_avg', o: [num(r.AvgCH), num(r.AvgCD), num(r.AvgCA)] },
    { src: 'b365', o: [num(r.B365CH), num(r.B365CD), num(r.B365CA)] },
  ].find((c) => c.o.every(Boolean));

  // Cotele de DESCHIDERE — necesare pentru CLV real: pariezi la deschidere și
  // vezi dacă linia s-a mișcat în favoarea ta până la închidere.
  const opening = [
    { src: 'pinnacle', o: [num(r.PSH), num(r.PSD), num(r.PSA)] },
    { src: 'market_avg', o: [num(r.AvgH), num(r.AvgD), num(r.AvgA)] },
    { src: 'b365', o: [num(r.B365H), num(r.B365D), num(r.B365A)] },
  ].find((c) => c.o.every(Boolean));

  const ouOpening = [
    { src: 'market_avg', o: [num(r['Avg>2.5']), num(r['Avg<2.5'])] },
    { src: 'b365', o: [num(r['B365>2.5']), num(r['B365<2.5'])] },
  ].find((c) => c.o.every(Boolean));

  const ouClosing = [
    { src: 'pinnacle', o: [num(r['PC>2.5']), num(r['PC<2.5'])] },
    { src: 'market_avg', o: [num(r['AvgC>2.5']), num(r['AvgC<2.5'])] },
    { src: 'b365', o: [num(r['B365C>2.5']), num(r['B365C<2.5'])] },
  ].find((c) => c.o.every(Boolean));

  // Asian Handicap: linia și cotele, de deschidere și de închidere.
  const ahLineOpen = r.AHh === '' || r.AHh === undefined ? null : Number(r.AHh);
  const ahLineClose = r.AHCh === '' || r.AHCh === undefined ? null : Number(r.AHCh);
  const ahOpening = [
    { src: 'pinnacle', o: [num(r.PAHH), num(r.PAHA)] },
    { src: 'market_avg', o: [num(r.AvgAHH), num(r.AvgAHA)] },
    { src: 'b365', o: [num(r.B365AHH), num(r.B365AHA)] },
  ].find((c) => c.o.every(Boolean));
  const ahClosing = [
    { src: 'pinnacle', o: [num(r.PCAHH), num(r.PCAHA)] },
    { src: 'market_avg', o: [num(r.AvgCAHH), num(r.AvgCAHA)] },
    { src: 'b365', o: [num(r.B365CAHH), num(r.B365CAHA)] },
  ].find((c) => c.o.every(Boolean));

  return {
    league: league ?? r.Div ?? r.League,
    country: country ?? r.Country ?? null,
    season: r.Season ?? null,
    date,
    home: r.HomeTeam ?? r.Home,
    away: r.AwayTeam ?? r.Away,
    homeGoals: hg,
    awayGoals: ag,
    outcome: hg > ag ? '1' : hg === ag ? 'X' : '2',
    goals: hg + ag,
    closingOdds: closing?.o ?? null,
    closingSource: closing?.src ?? null,
    openingOdds: opening?.o ?? null,
    openingSource: opening?.src ?? null,
    ouClosingOdds: ouClosing?.o ?? null,
    ouClosingSource: ouClosing?.src ?? null,
    ouOpeningOdds: ouOpening?.o ?? null,
    ahLineOpen: Number.isFinite(ahLineOpen) ? ahLineOpen : null,
    ahLineClose: Number.isFinite(ahLineClose) ? ahLineClose : null,
    ahOpeningOdds: ahOpening?.o ?? null,
    ahClosingOdds: ahClosing?.o ?? null,
    // BTTS nu are cote în sursă — doar rezultatul, pentru calibrare.
    btts: hg > 0 && ag > 0,
  };
}

async function fetchCsv(path) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (predictbot research)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

/** O ligă principală, pentru un sezon (ex. E0 / 2425). Are Over/Under 2.5. */
export async function loadMainLeague(code, season) {
  return cached(['fd', `v${SCHEMA_VERSION}`, 'main', code, season], async () => {
    const rows = parseCsv(await fetchCsv(`mmz4281/${season}/${code}.csv`));
    return rows.map((r) => normalizeRow(r, { league: code })).filter(Boolean);
  });
}

/** O ligă suplimentară (ex. ROU), toate sezoanele într-un fișier. Doar 1X2. */
export async function loadExtraLeague(countryCode) {
  return cached(['fd', `v${SCHEMA_VERSION}`, 'extra', countryCode], async () => {
    const rows = parseCsv(await fetchCsv(`new/${countryCode}.csv`));
    return rows
      .map((r) => normalizeRow(r, { league: `${r.Country}/${r.League}`, country: r.Country }))
      .filter(Boolean);
  });
}

/** Mai multe sezoane dintr-o ligă principală. */
export async function loadMainSeasons(code, seasons) {
  const out = [];
  for (const s of seasons) {
    try { out.push(...await loadMainLeague(code, s)); }
    catch (err) { log.warn('fd_season_missing', { code, season: s, error: err.message }); }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export { SCHEMA_VERSION };
export default { parseCsv, parseDate, normalizeRow, loadMainLeague, loadExtraLeague, loadMainSeasons, SCHEMA_VERSION };
