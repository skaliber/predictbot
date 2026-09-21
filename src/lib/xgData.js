/**
 * xG per meci, din datele FPL istorice (vaastav/Fantasy-Premier-League).
 *
 * Understat a închis accesul programatic (pagina nu mai încorporează JSON-ul),
 * iar football-data.co.uk n-are xG. FPL publică `expected_goals` per jucător
 * per etapă începând cu sezonul 2022/23; agregat pe echipă și meci, dă xG
 * pentru/împotriva. Doar Premier League.
 *
 * Limitare de reținut: xG-ul FPL e cel al furnizorului lor (Opta), rotunjit la
 * două zecimale per jucător. Suma pe echipă e aproximativ xG-ul real al echipei.
 */
import { cached } from './cache.js';
import log from './log.js';

const RAW = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';

/** Sezoanele cu xG disponibil — FPL a început să-l publice în 2022/23. */
export const XG_SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26'];

const SCHEMA_VERSION = 1;

function parseCsv(text) {
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
  const header = split(lines[0]).map((h) => h.replace(/^﻿/, '').trim());
  return lines.slice(1).map((l) => {
    const c = split(l);
    return Object.fromEntries(header.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

/**
 * Agregă rândurile de jucători într-un rând per meci.
 *
 * Fiecare meci apare de două ori în date (o dată per echipă), iar `fixture`
 * identifică meciul. `was_home` spune care parte e care.
 */
export function aggregateFixtures(playerRows, season) {
  const byFixture = new Map();

  for (const r of playerRows) {
    const fixture = r.fixture;
    const xg = Number(r.expected_goals);
    if (!fixture || !Number.isFinite(xg)) continue;
    const isHome = String(r.was_home).toLowerCase() === 'true';

    if (!byFixture.has(fixture)) {
      byFixture.set(fixture, {
        season, fixture,
        date: (r.kickoff_time ?? '').slice(0, 10),
        round: Number(r.round),
        home: null, away: null,
        xgHome: 0, xgAway: 0,
        homeGoals: Number(r.team_h_score),
        awayGoals: Number(r.team_a_score),
      });
    }
    const f = byFixture.get(fixture);
    if (isHome) { f.home = r.team; f.xgHome += xg; }
    else { f.away = r.team; f.xgAway += xg; }
  }

  return [...byFixture.values()]
    .filter((f) => f.home && f.away && Number.isFinite(f.homeGoals) && Number.isFinite(f.awayGoals))
    .map((f) => ({
      ...f,
      xgHome: Math.round(f.xgHome * 1000) / 1000,
      xgAway: Math.round(f.xgAway * 1000) / 1000,
      outcome: f.homeGoals > f.awayGoals ? '1' : f.homeGoals === f.awayGoals ? 'X' : '2',
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Un sezon complet, toate etapele. */
export async function loadSeason(season, { maxGw = 38 } = {}) {
  return cached(['fpl', `v${SCHEMA_VERSION}`, season], async () => {
    const rows = [];
    for (let gw = 1; gw <= maxGw; gw++) {
      try {
        const res = await fetch(`${RAW}/${season}/gws/gw${gw}.csv`, {
          headers: { 'User-Agent': 'predictbot research' },
        });
        if (!res.ok) continue;
        rows.push(...parseCsv(await res.text()));
      } catch (err) {
        log.warn('fpl_gw_failed', { season, gw, error: err.message });
      }
    }
    return aggregateFixtures(rows, season);
  });
}

/** Mai multe sezoane, cronologic. */
export async function loadXgSeasons(seasons = XG_SEASONS) {
  const out = [];
  for (const s of seasons) {
    const rows = await loadSeason(s);
    log.info('fpl_season_loaded', { season: s, matches: rows.length });
    out.push(...rows);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Normalizează numele echipelor între FPL și football-data.co.uk, ca să se
 * poată lipi xG-ul peste cotele reale. Diferențele sunt puține și stabile.
 */
const ALIASES = {
  'Man City': 'Man City', 'Man Utd': 'Man United', 'Spurs': 'Tottenham',
  "Nott'm Forest": "Nott'm Forest", 'Nottingham Forest': "Nott'm Forest",
  'Sheffield Utd': 'Sheffield United', 'Wolves': 'Wolves',
  'Newcastle': 'Newcastle', 'Leicester': 'Leicester', 'Luton': 'Luton',
  'West Ham': 'West Ham', 'Brighton': 'Brighton', 'Leeds': 'Leeds',
};

export function normalizeTeam(name) {
  if (!name) return null;
  return ALIASES[name] ?? name;
}

/** Cheie de lipire între surse: dată + cele două echipe normalizate. */
export function joinKey(date, home, away) {
  return `${date}|${normalizeTeam(home)}|${normalizeTeam(away)}`;
}

export { SCHEMA_VERSION };
export default { loadSeason, loadXgSeasons, aggregateFixtures, normalizeTeam, joinKey, XG_SEASONS };
