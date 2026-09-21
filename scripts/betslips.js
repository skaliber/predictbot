#!/usr/bin/env node
/**
 * Motorul pentru /bets: analizează slate-ul, aplică regulile de screening și
 * propune bilete. Ieșirea e JSON pe stdout (log-urile merg pe stderr).
 *
 *   node scripts/betslips.js --hours=48 [--league=PL] [--legs=3] [--slips=2]
 *                            [--stake=50] [--min-tier=MODERATE] [--markdown]
 */
import { analyseSlate, buildSlips, sieveSlate, STAKE } from '../src/bot/betslips.js';

function parseArgs() {
  const a = { _: [] };
  for (const s of process.argv.slice(2)) {
    if (s.startsWith('--')) { const [k, v] = s.slice(2).split('='); a[k] = v === undefined ? true : v; }
    else a._.push(s);
  }
  return a;
}

const args = parseArgs();
const hoursAhead = Number(args.hours ?? 48);
const legsPerSlip = Number(args.legs ?? STAKE.legsPerSlip);
const maxSlips = Number(args.slips ?? STAKE.slips);
const stake = Number(args.stake ?? STAKE.perSlip);
const minTier = String(args['min-tier'] ?? 'MODERATE').toUpperCase();

const ro = (d) => new Date(d).toLocaleString('ro-RO', {
  timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

function sieveMarkdown(sv, total) {
  const L = [];
  L.push(`## Sita — ${sv.play.length} din ${total} meciuri`);
  L.push('');
  if (!sv.play.length) { L.push('> Niciun meci peste prag azi.'); return L.join('\n'); }
  L.push('| # | Meci | Ligă | Ora | Pick | Șansă | Cotă corectă | Cota ta | Marja casei | Sursă | Notă |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  // În raport, câmpurile sitei sunt aplatizate direct pe obiect.
  sv.play.forEach((s, i) => {
    const c = s;
    const k = { '1': 0, X: 1, '2': 2 }[s.pick];
    const mine = c.market_odds?.[k];
    // Cota corectă vine din ACELEAȘI cote, fără marjă — deci diferența e pur
    // marja casei pe acel rezultat, nu un semnal de valoare.
    const margin = mine ? ((s.fairOdds / mine - 1) * 100).toFixed(1) + '%' : '—';
    L.push(`| ${i + 1} | ${c.match.home} – ${c.match.away} | ${c.match.league} | ${ro(c.match.kickoff)} | **${s.pick}** | ` +
      `${(s.prob * 100).toFixed(0)}% | ${s.fairOdds.toFixed(2)} | ${mine ? mine.toFixed(2) : '—'} | ${margin} | ${s.source} | ${s.notes.join('; ') || '—'} |`);
  });
  L.push('');
  const parts = [];
  if (sv.slip2) parts.push(`primele 2 împreună: **${(sv.slip2 * 100).toFixed(0)}%**`);
  if (sv.slip3) parts.push(`primele 3 împreună: **${(sv.slip3 * 100).toFixed(0)}%**`);
  if (parts.length) L.push(`**Șanse pentru biletele de azi** — ${parts.join(' · ')}`);
  L.push('');
  const fromModel = sv.play.filter((c) => c.source === 'model').length;
  L.push('_Reper istoric, pe zile de weekend cu favoriți puternici (~36 meciuri): top 4 ies 80.5%, ' +
    'bilet de 2 → 71%, bilet de 3 → 56%. Cifrele de mai sus sunt ale meciurilor de azi — contează ele._');
  if (fromModel) {
    L.push(`_${fromModel} din ${sv.play.length} pick-uri n-au cote: probabilitatea e doar din model, validat mai slab (77% vs 80.5%)._`);
  }
  L.push('_„Marja casei" = cât sub valoarea reală plătește casa pe acel rezultat. Nu e un semnal — e costul pariului._');
  if (sv.leave.length) {
    L.push('');
    L.push(`<details><summary>Lasă (${sv.leave.length})</summary>`);
    L.push('');
    for (const c of sv.leave.slice(0, 20)) L.push(`- ${c.match.home} – ${c.match.away} (${c.match.league}): ${c.reason}`);
    L.push('</details>');
  }
  return L.join('\n');
}

function markdown(report) {
  const L = [];
  L.push(sieveMarkdown(report.sieve, report.slate.analyzed));
  L.push('');
  L.push('---');
  L.push('');
  L.push(`## Bilete — fereastră ${report.window.hours}h (${report.slate.analyzed} meciuri analizate)`);
  L.push('');
  if (!report.slips.length) {
    L.push(`> Niciun bilet. ${report.build.incomplete ?? 'Nu sunt candidați eligibili.'}`);
  }
  for (const s of report.slips) {
    L.push(`### Tabel ${s.id} — ${s.stake_ron} RON`);
    L.push('');
    L.push('| Meci | Ligă | Ora | Pick | Cotă | Model | Edge | Tier | Susținere |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const l of s.legs) {
      const p = l.pick;
      const cons = l.support.consensus;
      const sup = cons?.available ? `${cons.models_for}/${cons.models_count} ${cons.signal}` : '—';
      L.push(`| ${l.match.home} – ${l.match.away} | ${l.match.league} | ${ro(l.match.kickoff)} | **${p.selection}** | ${p.odds?.toFixed(2) ?? '—'} | ${p.prob_pct}% | ${Number.isFinite(p.edge_pct) ? `${p.edge_pct > 0 ? '+' : ''}${p.edge_pct}pp` : '—'} | ${l.tier} | ${sup} |`);
    }
    L.push('');
    const parts = [`Probabilitate combinată: **${s.combined_prob_pct}%**`];
    if (s.combined_odds) parts.push(`cotă combinată **${s.combined_odds}** → potențial **${s.potential_return_ron} RON**`);
    else parts.push('_cote indisponibile pentru toate legurile — returul nu poate fi calculat_');
    L.push(parts.join(' · '));
    L.push('');
    const warned = s.legs.flatMap((l) => l.flags.filter((f) => f.severity !== 'note').map((f) => `- **${l.match.home}–${l.match.away}**: ${f.message}`));
    if (warned.length) { L.push('**Avertismente:**'); L.push(...warned); L.push(''); }
  }
  if (report.excluded.length) {
    L.push('### Excluse');
    L.push('');
    L.push('| Meci | Ligă | Motiv |');
    L.push('|---|---|---|');
    for (const e of report.excluded.slice(0, 15)) {
      const why = e.flags.filter((f) => f.severity === 'exclude').map((f) => f.message).join(' ') || e.no_bet_reason || '—';
      L.push(`| ${e.match.home} – ${e.match.away} | ${e.match.league} | ${why} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

const candidates = await analyseSlate({ hoursAhead, league: args.league, limit: Number(args.limit ?? 60) });
const build = buildSlips(candidates, { legsPerSlip, maxSlips, stake, minTier });
const sieve = sieveSlate(candidates, { top: Number(args.top ?? 4) });

const report = {
  generated_at: new Date().toISOString(),
  window: { hours: hoursAhead, league: args.league ?? null },
  slate: {
    total: candidates.length,
    analyzed: candidates.length,
    eligible: candidates.filter((c) => c.pick && !c.excluded).length,
    excluded: candidates.filter((c) => c.excluded).length,
    no_bet: candidates.filter((c) => !c.excluded && !c.pick).length,
  },
  stake_policy: { ...STAKE, per_slip_ron: stake, legs_per_slip: legsPerSlip, min_tier: minTier },
  sieve: {
    play: sieve.play.map((c) => ({ slug: c.slug, match: c.match, ...c.sieve, market_odds: c.market_odds })),
    leave: sieve.leave.map((c) => ({ slug: c.slug, match: c.match, reason: c.leaveReason })),
    slip2: sieve.slip2, slip3: sieve.slip3,
  },
  slips: build.slips,
  build: { incomplete: build.incomplete, unused_candidates: build.unused_candidates },
  candidates: candidates.filter((c) => !c.excluded),
  excluded: candidates.filter((c) => c.excluded),
};

process.stdout.write(args.markdown ? `${markdown(report)}\n` : `${JSON.stringify(report, null, 2)}\n`);
