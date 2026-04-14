# 15 Rules Optimization Plan (v3)

## Purpose

Define a practical optimization plan for stable, transparent, and profile-driven game behavior.

## Planning Principles

- One source of truth: `math/game-rules-v2.json`.
- Tune per RTP profile (`96.38 / 94.40 / 92.38`), not one global constant.
- Keep high volatility while controlling tail-risk.
- Keep simulation and live behavior observable and auditable.

## Rule Plan

1. RTP control:
- Use profile-level payout scaling in rules config.
- Keep profile-level target band + tolerance checks.

2. Tail-risk control:
- Cap base sequence multiplier accumulation.
- Cap free-spin persistent multiplier accumulation.
- Keep max win cap at `20000x`.

3. Bonus quality:
- Ensure free-spin catches appear in large simulations.
- Report `bonus_catch_count`, `bonus_awarded_spins_total`, `bonus_win_total`.

4. UX integrity:
- Tumble must remove winners before refill.
- Intro drop must avoid pre-reveal flash.
- Last 10 Spins must include spin and event history.

## Acceptance Gates

For each release profile (`steps=1,000,000`, allowed bet set):

- RTP in profile target band with configured tolerance
- Casino net > 0
- Bonus catches > 0
- SSE simulation and direct simulation metrics consistent

## Rollout Checklist

1. Update `math/game-rules-v2.json` version and profile notes.
2. Run 1,000,000-spin validation per RTP profile.
3. Save results in simulation report docs.
4. Tag build with math config id + rules config id.
