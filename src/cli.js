#!/usr/bin/env node
/**
 * CLI: predictbot <comandă> [opțiuni]
 *
 *   predictbot upcoming [--hours=48] [--league=PL]
 *   predictbot predict <slug> [--bot=ai-analyst] [--odds=2.10,3.40,3.20] [--odds-format=decimal] [--json]
 *   predictbot compare <slug>            # toate personalitățile pe același meci
 *   predictbot bots
 */
import { predictMatch, getUpcomingMatches, personalities } from './index.js';
import config from './config.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    } else args._.push(a);
  }
  return args;
}

function parseOdds(raw) {
  if (!raw || raw === true) return null;
  const parts = String(raw).split(',').map((s) => Number(s.trim()));
  if (parts.some((n) => !Number.isFinite(n))) throw new Error('--odds: valori numerice separate prin virgulă');
  if (parts.length === 3) return { '1x2': parts };
  if (parts.length === 2) return { over_under: parts };
  throw new Error('--odds: 3 valori pentru 1X2 (1,X,2) sau 2 pentru Over/Under 2.5');
}

function printResult(r) {
  const p = r.probabilities;
  console.log(`\n\x1b[1m${r.bot.name}\x1b[0m — ${r.slug}`);
  console.log(`  1 ${p.home_win_pct}%  X ${p.draw_pct}%  2 ${p.away_win_pct}%` +
    (p.over25_pct !== null ? `  |  Over2.5 ${p.over25_pct}%  BTTS ${p.btts_pct}%` : ''));
  console.log(`  \x1b[1mPredicție:\x1b[0m ${r.prediction}` +
    (r.confidence !== null ? ` @ ${r.confidence}% încredere` : ''));
  if (r.edge_pct !== null) console.log(`  Edge ${r.edge_pct > 0 ? '+' : ''}${r.edge_pct}pp · EV ${r.ev_percent}% · Kelly ${(r.kelly_stake * 100).toFixed(2)}%`);
  console.log(`\n  ${r.reasoning.summary}`);
  for (const b of r.reasoning.bullets) console.log(`   • ${b}`);
  if (r.partial_sources) console.log(`  \x1b[33m! surse parțiale:\x1b[0m ${r.partial_sources.map((s) => s.source).join(', ')}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!cmd || cmd === 'help' || args.help) {
    console.log(`predictbot — AI Analyst pentru PredictCamp

  predictbot upcoming [--hours=48] [--league=PL] [--limit=20]
  predictbot predict <slug> [--bot=ai-analyst] [--odds=2.10,3.40,3.20] [--json] [--persist]
  predictbot compare <slug> [--odds=...]
  predictbot bots

Personalități: ${Object.keys(personalities).join(', ')}`);
    return;
  }

  if (cmd === 'bots') {
    for (const p of Object.values(personalities)) {
      console.log(`\x1b[1m${p.id}\x1b[0m — ${p.name}\n  ${p.tagline}\n  piețe: ${p.policy.markets.join(', ')} · edge ≥ ${p.policy.minEdgePct}% · încredere ≥ ${p.policy.minConfidence}%`);
    }
    return;
  }

  if (cmd === 'upcoming') {
    const matches = await getUpcomingMatches({
      hoursAhead: args.hours ? Number(args.hours) : config.cron.hoursAhead,
      league: args.league,
      limit: args.limit ? Number(args.limit) : 30,
    });
    if (args.json) { console.log(JSON.stringify(matches, null, 2)); return; }
    console.log(`${matches.length} meciuri în fereastră:`);
    for (const m of matches) {
      console.log(`  ${m.match_date?.slice(0, 16).replace('T', ' ')}  ${m.home_team} vs ${m.away_team}  [${m.league_name}]  ${m.slug}`);
    }
    return;
  }

  const slug = args._[0];
  if (!slug) throw new Error(`comanda "${cmd}" are nevoie de un <slug>`);
  const odds = parseOdds(args.odds);
  const common = { odds, oddsFormat: args['odds-format'] || 'decimal', persist: Boolean(args.persist) };

  if (cmd === 'predict') {
    const r = await predictMatch(slug, { ...common, personalityId: args.bot || config.bot.id });
    if (args.json) console.log(JSON.stringify(r, null, 2)); else printResult(r);
    return;
  }

  if (cmd === 'compare') {
    const out = [];
    for (const id of Object.keys(personalities)) {
      try {
        out.push(await predictMatch(slug, { ...common, personalityId: id, persist: false }));
      } catch (err) { out.push({ bot: { id, name: id }, error: err.message }); }
    }
    if (args.json) { console.log(JSON.stringify(out, null, 2)); return; }
    for (const r of out) {
      if (r.error) { console.log(`\n${r.bot.name}: eroare — ${r.error}`); continue; }
      printResult(r);
    }
    return;
  }

  throw new Error(`comandă necunoscută: ${cmd}`);
}

main().catch((err) => {
  console.error(`\x1b[31mEroare:\x1b[0m ${err.message}`);
  process.exitCode = 1;
});
