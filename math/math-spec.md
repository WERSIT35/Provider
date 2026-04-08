# Math Specification v1

## Objective

Define a certifiable math package for the first release candidate.

## Inputs

- `paytable-v1.json`
- `reel-strips-v1.json`
- Feature rules from `docs/feature-spec.md`

## Target Metrics (Current Tuning Direction)

- RTP (theoretical target band): 95.00% to 96.50%
- Hit frequency target: 36% to 40%
- Bonus frequency: once every 130-220 spins
- Max win: x7,500
- Volatility: medium-high

## RTP Decomposition Target

- Base game contribution: 62% to 70%
- Bonus contribution: 26% to 34%
- Scatter direct pays: 1% to 4%

## Evaluation Steps

1. Resolve reel stops via server RNG.
2. Apply feature modifiers.
3. Evaluate line wins.
4. Add scatter and bonus components.
5. Apply multipliers where valid.
6. Return normalized payout in bet multiplier.

## Constraints

- No hidden payout manipulation by user segment.
- No run-time math changes without signed config deployment.
- Config IDs must be logged with every spin.

## Tuning Strategy

1. Tune base hit frequency with symbol density.
2. Tune top-end wins by high symbol distribution and wild placements.
3. Tune bonus EV through trigger rate and multiplier growth.

## Approval Checklist

- Math spec reviewed by product and backend.
- Simulated 10M+ spins for candidate profile.
- Empirical RTP within +/-0.15% of theoretical target.
