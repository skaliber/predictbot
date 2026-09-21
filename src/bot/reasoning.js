/**
 * Generator de reasoning narativ. Nu cheamă niciun LLM: construiește textul din
 * puncte de date verificabile, ca să fie reproductibil și auditabil.
 * Vocea diferă per personalitate (`personality.voice`).
 */
import { formStats } from './personalities.js';

const VOICE_OPENERS = {
  analytic: 'Am comparat modelele înainte să decid.',
  sober: 'Mă uit la medii, nu la titluri.',
  energetic: 'Contează cine vine în formă acum.',
  historic: 'Istoria directă spune destul.',
  mathematical: 'Totul pleacă de la lambda.',
  value: 'Nu mă interesează cine câștigă, ci cât plătește piața.',
  contrarian: 'Piața plătește prost outsiderii.',
};

function formLine(teamLabel, form) {
  const s = formStats(form);
  if (!s) return null;
  const seq = form.map((m) => m.result).join('');
  return `${teamLabel}: ${seq} în ultimele ${s.matches} (${s.points}/${s.max_points} puncte, ${s.goals_for.toFixed(1)} marcate / ${s.goals_against.toFixed(1)} primite pe meci)`;
}

function h2hLine(h2h) {
  if (!h2h?.matches_analyzed) return null;
  return `H2H pe ${h2h.matches_analyzed} meciuri: ${h2h.home_wins}-${h2h.draws}-${h2h.away_wins}, medie ${h2h.avg_goals_per_match} goluri, Over 2.5 în ${h2h.over25_pct}%`;
}

/**
 * @returns {{ summary: string, bullets: string[], voice: string }}
 */
export function buildReasoning({ analysis, pick, personality, context, reasonNoBet }) {
  const bullets = [];
  const d = analysis.models_detail ?? {};

  if (d.dixon_coles) {
    bullets.push(
      `Dixon-Coles: λ ${d.dixon_coles.lambda_home.toFixed(2)} − ${d.dixon_coles.lambda_away.toFixed(2)} ` +
      `(${d.dixon_coles.expected_goals.toFixed(2)} goluri așteptate, scor cel mai probabil ${d.dixon_coles.most_likely_score})`
    );
  }
  if (d.monte_carlo) {
    bullets.push(
      `Monte Carlo ${d.monte_carlo.simulations.toLocaleString('ro-RO')} simulări: ` +
      `1 ${d.monte_carlo.home_win_pct}% / X ${d.monte_carlo.draw_pct}% / 2 ${d.monte_carlo.away_win_pct}%, ` +
      `Over 2.5 ${d.monte_carlo.over25_pct}%, BTTS ${d.monte_carlo.btts_pct}%`
    );
    if (personality.voice === 'contrarian' && d.monte_carlo.upset) {
      bullets.push(
        `Coada de upset: outsiderul (${d.monte_carlo.upset.side}) câștigă cu 2+ goluri în ` +
        `${(d.monte_carlo.upset.probability * 100).toFixed(1)}% din simulări`
      );
    }
  }
  if (d.elo) bullets.push(`Elo: ${Math.round(d.elo.home_rating)} vs ${Math.round(d.elo.away_rating)} (diferență ${Math.round(d.elo.diff)})`);
  if (d.poisson) bullets.push(`Poisson baseline: λ ${d.poisson.lambda_home.toFixed(2)} − ${d.poisson.lambda_away.toFixed(2)}`);
  if (d.predictcamp_ensemble) {
    bullets.push(
      `Ensemble PredictCamp${d.predictcamp_ensemble.calibrated ? ' (calibrat)' : ''}: ` +
      `${d.predictcamp_ensemble.prediction} la ${d.predictcamp_ensemble.confidence}% încredere`
    );
  }

  if (d.ml_1x2) {
    bullets.push(
      `ML calibrat: 1 ${d.ml_1x2.home_win_pct}% / X ${d.ml_1x2.draw_pct}% / 2 ${d.ml_1x2.away_win_pct}% ` +
      '(antrenat fără cote de bookmaker)'
    );
  }
  if (d.trends) {
    bullets.push(
      `Tendințe istorice: colțuri ${d.trends.corners.avg.toFixed(1)} vs linia ${d.trends.corners.line} (${d.trends.corners.side}), ` +
      `cartonașe ${d.trends.cards.avg.toFixed(1)} vs ${d.trends.cards.line} (${d.trends.cards.side}), ` +
      `eșantion ${d.trends.corners.sample_size} meciuri`
    );
  }

  const c = analysis.models_consensus;
  if (c?.available) {
    bullets.push(`Acord între modele: ${c.models_for}/${c.models_count} pe „${c.consensus}” (${c.agreement_pct}%, semnal ${c.signal})`);
  }

  if (context) {
    const fh = formLine('Gazde', context.home_form);
    const fa = formLine('Oaspeți', context.away_form);
    const hh = h2hLine(context.h2h);
    if (personality.voice === 'energetic' || personality.voice === 'analytic') {
      if (fh) bullets.push(fh);
      if (fa) bullets.push(fa);
    }
    if (hh && (personality.voice === 'historic' || personality.voice === 'analytic')) bullets.push(hh);
  }

  if (pick && Number.isFinite(pick.edge_pct)) {
    bullets.push(
      `Piață: cota ${pick.book_odds.toFixed(2)} implică ${pick.market_fair_prob_pct}% după de-vig (vig ${pick.vig_pct}%); ` +
      `modelul spune ${pick.model_prob_pct}% → edge ${pick.edge_pct > 0 ? '+' : ''}${pick.edge_pct}pp, EV ${pick.ev_pct > 0 ? '+' : ''}${pick.ev_pct}%`
    );
    bullets.push(`Miza Kelly fracționat (${personality.policy.kellyFraction}): ${(pick.kelly_stake * 100).toFixed(2)}% din bankroll`);
  } else if (pick) {
    bullets.push('Fără cote disponibile — selecția e pe încredere de model, nu pe value.');
  }
  if (analysis.odds_source === 'predictcamp_market_odds' && analysis.odds_meta) {
    bullets.push(
      `Cote de piață din PredictCamp (${analysis.odds_meta.source ?? 'necunoscut'}), ` +
      `actualizate ${analysis.odds_meta.updated_at?.slice(0, 16).replace('T', ' ') ?? 'n/a'}`
    );
  }

  if (pick?.market === 'double_chance') {
    bullets.push(
      `Convertit din „${pick.converted_from.selection}" (${pick.converted_from.prob_pct}% încredere) în dublă șansă. ` +
      `Cota ${pick.book_odds} e replicată din piața 1X2, deci nu există edge de preț.`
    );
    bullets.push(`⚠ ${pick.warning}`);
  }

  const opener = VOICE_OPENERS[personality.voice] ?? VOICE_OPENERS.analytic;
  const summary = pick
    ? `${opener} Aleg ${pick.label} (${pick.selection}) la ${pick.model_prob_pct}% încredere` +
      (Number.isFinite(pick.edge_pct) ? `, cu ${pick.edge_pct > 0 ? '+' : ''}${pick.edge_pct}pp edge față de piață.` : '.')
    : `${opener} Nu pariez pe acest meci. ${reasonNoBet ?? ''}`.trim();

  return { summary, bullets, voice: personality.voice };
}

export default { buildReasoning };
