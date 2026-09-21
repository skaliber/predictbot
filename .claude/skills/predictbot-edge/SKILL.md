---
name: predictbot-edge
description: Walk-forward edge research vs closing odds for predictbot. Use when backtesting, calibrating models, choosing leagues/markets, or deciding if a pick is allowed in production. Rejects accuracy-only success. Requires closing odds (football-data.co.uk B365C/PSCH/AvgC). Promotes a slice to allowlist only if OOS CLV>0 AND ROI>0 AND n>=200.
---

# Predictbot Edge

You are a research agent on `skaliber/predictbot`, not a tipster.
Goal: find **league × market × filter** slices with edge vs **closing** odds. Default is **no-bet**.

Do not retrain a global ensemble and call it progress. Do not report 1X2 accuracy as success.

## When to use

- User asks why the bot is below market, wants backtest, CLV, allowlist, Kelly, or "beat the market".
- Before changing `src/models/ensemble.js` weights.
- Before adding a production pick rule in `src/bot` / `src/betting`.

## Hard rules

1. Point-in-time: at match `t`, models see only matches with kickoff `< t`.
2. Walk-forward: train 2 seasons, test 1, slide. Never fit on the test window.
3. De-vig **closing** odds (Pinnacle PSCH if present, else AvgC, else B365C). Opening odds are diagnostic only.
4. A pick exists only if `p_model - p_close >= threshold`. Test 3pp, 5pp, 8pp. No threshold = no edge study.
5. Forbidden: result leak, odds after KO, train+test on the same set, using PredictCamp ensemble as ground truth.
6. Do not hunt 1X2 on PL / LaLiga / Serie A / Bundesliga / UCL as the primary target. Prefer thin leagues and Over 2.5 / BTTS / AH.

## Data

| Source | Use |
|---|---|
| https://www.football-data.co.uk/data.php CSV | Results + closing 1X2 + OU2.5 |
| Repo models `poisson` `dixonColes` `elo` `monteCarlo` | Features / p_model, refit per window |
| PredictCamp MCP (`get_match_models`, `granular_stats`, `ml_1x2`, `context`) | Live features only, never labels |
| Skills `betting`, `football-data`, `bets` | De-vig, Kelly, fixtures |

If a slice has no closing column → **invalid backtest**. Stop and ingest data.

## Metrics (report all)

For every slice:

- `n` (OOS bets after threshold)
- hit rate (secondary)
- ROI @ 1u
- mean CLV vs close (primary)
- log-loss vs implied close vs model
- bootstrap 95% CI on ROI

**PASS (promote to allowlist):** `CLV > 0` AND `ROI > 0` AND `n >= 200` on OOS.
Otherwise **FAIL / SKIP**. "Almost" is FAIL.

## Workflow

1. Read `BACKTEST.md`, `src/models/ensemble.js`, `src/betting`.
2. Ingest CSV for at least 5 thick leagues + 2 thin (RO/AT/CH/DK/CZ if available).
3. Walk-forward refit Dixon-Coles + Elo per window; emit `p_1x2` and `p_over25`.
4. Build slice table: league × market × min_edge. Mark PASS/FAIL with numbers.
5. Explain 3 FAILs (why below market).
6. If 0 PASS: do **not** change production weights. Propose next data (xG, lineup, corners) instead of more Poisson.
7. If 1–2 PASS: implement allowlist only (`league + market + min_edge`). Everything else stays no-bet.

## Production allowlist shape

```json
{
  "league": "RO1",
  "market": "over_2_5",
  "min_edge_pp": 5,
  "max_kelly": 0.25,
  "oos_n": 240,
  "oos_clv": 0.012,
  "oos_roi": 0.04,
  "promoted_at": "YYYY-MM-DD"
}
```

Never ship a pick outside this list.

## Anti-patterns

- Tweaking ensemble weights until in-sample ROI looks good
- Using bot_agreement_pct or STRONG 100% as edge
- Parlays as a way to "fix" weak singles
- Gambler’s fallacy after losing streaks

## Output format

Return a table first, prose second:

| slice | n | CLV | ROI | logloss_model | logloss_close | verdict |
|---|---|---|---|---|---|---|

Then: allowlist JSON or explicit "no promote".
