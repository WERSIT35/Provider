# 03 Game Design (Features + Player Economy)

## Goal
Define and maintain a commercially viable high-volatility `5x4` pay-anywhere slot profile aligned with runtime implementation.

## Core Design Targets

- Grid: `5x4`
- Win model: symbols pay anywhere (minimum `8` matches)
- Volatility: high
- RTP profiles:
  - `bananax` -> `96.38%`
  - `bananax_94` -> `94.40%`
  - `bananax_92` -> `92.38%`
- Max win hard cap: `20000x`
- Session feel: chain tumbles, multiplier escalation, rare high-value peaks

## Tasks

1. Keep `docs/GDD.md` synced with runtime behavior.
2. Keep feature stack synced with backend engine:
- Tumble + sequence multiplier accumulation
- Free spins with persistent multiplier progression
- Ante bet and buy-free-spins constraints
3. Maintain economy controls:
- RTP profile targets and tolerances
- Bonus trigger frequency and payout distribution
- Dead-spin and tail risk monitoring
4. Responsible design:
- No deceptive UI
- Clear rules and disclosures
- Simulation transparency for audits

## Deliverables

- `docs/GDD.md`
- `docs/feature-spec.md`
- `docs/game-rules-draft.md`
- `math/game-rules-v2.json`

## Exit Criteria

- Feature set and rules are implementation-ready.
- Profile RTP assumptions are documented.
- QA simulation process is defined for each RTP profile.

## Next

Proceed to [04 Math RNG RTP](04-math-rng-rtp.md).
