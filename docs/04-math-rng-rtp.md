# 04 Math, RNG, RTP, and Fairness

## Goal
Produce a certifiable math model and RNG framework with stable RTP behavior.

## Key Principle

Profitability comes from defined house edge at scale, not hidden manipulation.

## Targets (Current v2)

- RTP target band: 96.20% to 96.80%
- RTP band tolerance for pass/fail check: +/-0.05%
- Profitability gate: repeated 1,000,000-spin validations must return positive casino net
- Bonus visibility gate: simulation must report non-zero bonus catches over large runs

## Tasks

1. Keep runtime rules in `math/game-rules-v2.json` as source of truth.
2. Define and enforce:
- Symbol distribution and payout tiers
- Multiplier distribution and caps
- Free-spin trigger/retrigger logic
3. Simulation framework:
- API simulation and SSE simulation must report identical final metrics
- Report RTP, net, hit rate, large-win counts, and bonus metrics
4. RNG architecture:
- Server-authoritative RNG only
- Cryptographic PRNG source
- Reproducibility mode for internal audit
5. Governance:
- Version all math/rules artifacts
- No production math changes without explicit config version bump

## Deliverables

- `math/math-spec.md`
- `math/game-rules-v2.json`
- `math/simulation-report-v1.md`

## Exit Criteria

- 1,000,000-spin validation in target RTP band (with tolerance)
- Positive casino net on current profile
- Bonus catches and bonus win totals present in simulation output

## Next

Proceed to [05 Backend Platform](05-backend-platform.md).
