# Math Specification v2

## Objective

Define a certifiable math package for the current 6x5 pay-anywhere tumble model.

## Inputs

- `math/game-rules-v2.json`
- Runtime feature logic in backend engine

## Target Metrics (Current Profile)

- RTP target band: 96.20% to 96.80%
- RTP pass tolerance: +/-0.05%
- Volatility: high
- Max win cap: x15,000
- Profitability safety rule: repeated 1,000,000-spin validations must produce positive `casino_net`.

## Bonus and Feature Targets

- Free-spin trigger: 4+ scatters in base game
- Free-spin start amount: 15
- Free-spin retrigger: 3+ scatters, +5 spins
- Bonus visibility: large simulation runs must show non-zero `bonus_catch_count`

## Evaluation Steps

1. Generate symbol grid from server RNG.
2. Evaluate pay-anywhere symbol wins (8/10/12+ tiers).
3. Apply tumble until no new win.
4. Collect sequence multipliers and apply with caps.
5. Apply payout scaler and max-win cap.
6. Award free spins if scatter conditions are met.
7. Return normalized payout and audit fields.

## Constraints

- No hidden per-player manipulation.
- No runtime math changes without versioned config update.
- Config IDs must be logged with every spin and simulation output.

## Release Gates

- 1,000,000-spin validation in target RTP band with tolerance
- Positive `casino_net`
- Bonus metrics reported and non-zero catches
- Simulation API and SSE stream final values aligned
