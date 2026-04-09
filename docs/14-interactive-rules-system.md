# 14 Interactive Rules System (Strict)

## Objective

Enforce a strict interactive rules system where runtime behavior is driven by `math/game-rules-v2.json` and exposed in-game through paged rules.

## Source of Truth

- Runtime rules config: `math/game-rules-v2.json`
- Rules API: `GET /api/v1/game-rules`
- In-game Rules UI: multi-page modal in client

## Strict Rule Contracts

1. Layout and win model:
- Grid: 6x5
- Win model: symbols pay anywhere
- Minimum symbol count for win: 8

2. Tumble behavior:
- Winning symbols are removed.
- Remaining symbols fall down and empty positions refill from top.
- Tumble repeats until no additional win is formed.

3. Multiplier behavior:
- Multiplier symbols can appear during base and tumble sequence.
- Values are limited to configured allowed list.
- Base game applies accumulated sequence multiplier at sequence end.
- Free spins apply persistent accumulated multiplier logic.
- Multiplier caps are enforced for risk control.

4. Free spins:
- Trigger in base game with 4+ scatters.
- Base award: 15 free spins.
- Retrigger in free spins with 3+ scatters for +5 spins.

5. Economy and safety:
- Theoretical RTP: 96.50%
- RTP validation band: 96.20% to 96.80%
- RTP pass/fail tolerance: +/-0.05%
- Bet range: 0.20 to 125.00
- Max win cap: 15000x

## Validation Requirements

- Backend rejects invalid rules payload at startup.
- Rules pages must be present and non-empty.
- Multiplier allowed-values list must be non-empty and bounded.
- Free-spin trigger/award values must be integers.
- Simulation must output bonus metrics (catch count and bonus win total).

## UI Requirements

- Rules button opens modal.
- Modal supports next/prev, close button, escape-to-close, click-outside-to-close.
- Metadata banner shows theoretical RTP, volatility, and mode.

## Implementation Notes

- Runtime APIs expose `rules_config_id` and `GET /api/v1/game-rules`.
- Client rules modal renders directly from rules payload.
- Simulation panel includes bonus catches and bonus win total.
