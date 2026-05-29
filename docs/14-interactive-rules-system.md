# 14 Interactive Rules System (Strict)

## Objective

Enforce strict runtime rule consistency where behavior is driven by `math/game-rules-v2.json` and rendered in the in-game rules modal.

## Source of Truth

- Runtime rules config: `math/game-rules-v2.json`
- Rules API: `GET /api/v1/game-rules?game_id=<id>`
- In-game rules UI: paged modal in client

## Strict Rule Contracts

1. Layout and win model:
- Grid: `5x4`
- Win model: symbols pay anywhere
- Minimum symbol count for win: `8`

2. Tumble behavior:
- Winning symbols are removed.
- Remaining symbols fall and empty positions refill from top.
- Tumble repeats until no additional win forms.

3. Multiplier behavior:
- Multipliers can appear in base and tumble sequence.
- Values must come from configured allowed list.
- Sequence accumulation must avoid double-counting the same multiplier symbol.
- Free spins use persistent multiplier accumulation.

4. Free spins:
- Trigger in base game with `4+` scatters.
- Base award: `15` free spins.
- Retrigger in free spins with `3+` scatters for `+5` spins.

5. Economy and safety:
- RTP profile modes: `96.38`, `94.40`, `92.38`
- Bet range: `0.20` to `500.00`
- Max win cap: `20000x`

## Validation Requirements

- Backend rejects invalid rules payload at startup.
- Rules pages must exist and be non-empty.
- Multiplier allowed-values list must be non-empty.
- Free-spin trigger/award values must be valid integers.
- Simulation outputs must include RTP and bonus metrics.

## UI Requirements

- Rules button opens modal.
- Modal supports next/prev, close button, escape-to-close, click-outside-to-close.
- Metadata shows RTP, volatility, and active profile.

## Implementation Notes

- Runtime APIs expose `rules_config_id` and profile-aware rules payload.
- Client rules modal renders directly from rules payload.
- Simulation panel reflects profile-aware RTP checks.
