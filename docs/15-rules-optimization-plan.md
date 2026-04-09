# 15 Rules Optimization Plan (v2)

## Purpose

Define the best practical plan for stable, profitable, and transparent game behavior.

## Planning Principles

- Keep one source of truth: `math/game-rules-v2.json`.
- Tune for target RTP center (~96.5%), not edge values.
- Keep high volatility but prevent catastrophic tails.
- Make simulation and live behavior observable with clear metrics.

## Rule Plan

1. RTP control:
- Use deterministic payout scaling (`RTP_PAYOUT_SCALER`) for fine centering.
- Keep check tolerance +/-0.05% to avoid false fail from sample/rounding noise.

2. Tail-risk control:
- Cap base sequence multiplier accumulation.
- Cap free-spin persistent multiplier accumulation.
- Keep max win cap at 15000x.

3. Bonus quality:
- Ensure free-spin catches are present in large simulations.
- Report `bonus_catch_count`, `bonus_awarded_spins_total`, and `bonus_win_total`.

4. UX integrity:
- Tumble must visually remove winners and then drop replacements.
- Fall animation should affect only impacted positions/columns.

## Acceptance Gates

For release-candidate profile (`steps=1,000,000`, bet in allowed list):

- RTP in `[96.2, 96.8]` with +/-0.05 tolerance
- Casino net > 0
- Bonus catches > 0
- SSE simulation and direct simulation final metrics are consistent

## Rollout Checklist

1. Update `math/game-rules-v2.json` version and notes.
2. Run 1,000,000-spin validation on each allowed bet.
3. Save results in `math/simulation-report-v1.md`.
4. Tag build with math config id and rules config id.
