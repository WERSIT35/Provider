# Math Specification v3

## Objective

Define a certifiable math package for the current `5x4` pay-anywhere tumble model.

## Inputs

- `math/game-rules-v2.json`
- Runtime feature logic in backend engine

## Target Metrics (Profile Driven)

- RTP profile modes:
  - `bananax` -> 96.38%
  - `bananax_94` -> 94.40%
  - `bananax_92` -> 92.38%
- Profile tolerance: +/-0.05% (band checks from rules config)
- Volatility: high
- Max win cap: `20000x`
- Profitability rule: repeated 1,000,000-spin validations must keep positive `casino_net`.

## Bonus and Feature Targets

- Free-spin trigger: 4+ scatters in base game
- Free-spin start amount: 15
- Free-spin retrigger: 3+ scatters, +5 spins
- Bonus visibility: large simulations must show non-zero `bonus_catch_count`

## Evaluation Steps

1. Generate symbol grid from server RNG.
2. Evaluate pay-anywhere symbol wins (8/10/12+ tiers).
3. Apply tumble until no new win appears.
4. Collect sequence multipliers with unique-symbol counting.
5. Apply profile payout scaler and max-win cap.
6. Award free spins if scatter conditions are met.
7. Return normalized payout and audit fields.

## Constraints

- No hidden per-player manipulation.
- No runtime math changes without versioned config update.
- Config IDs and profile IDs must be logged with spin and simulation output.

## Release Gates

- 1,000,000-spin validation per RTP profile in target band with tolerance
- Positive `casino_net`
- Bonus metrics reported and non-zero catches
- Simulation API and SSE stream final values aligned
