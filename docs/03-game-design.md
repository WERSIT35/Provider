# 03 Game Design (Features + Player Economy)

## Goal
Define a fun, clear, and commercially viable 6x5 tumble slot design before coding.

## Core Design Targets

- Grid: 6x5
- Win model: symbols pay anywhere (minimum 8 matches)
- Volatility: high
- RTP target: 96.20% to 96.80% primary build
- Max win target: x15,000 hard cap
- Session feel: tumble chain excitement with rare, meaningful bonus cycles
- Profitability rule: release candidate must pass repeated 1,000,000-spin checks with positive casino net.

## Tasks

1. Write GDD (`docs/GDD.md`) with theme, symbols, tumble flow, multipliers, and free-spin cycle.
2. Define feature stack:
- Base tumble + multiplier sequence
- Free spins with persistent multiplier
- Ante bet and buy-free-spins constraints
3. Economy controls:
- Hit frequency target range
- Bonus trigger frequency target range
- Win distribution goals (small/base/large tails)
- Dead-spin tolerance
4. Responsible design:
- No deceptive UI
- Clear rules and payout disclosures
- Configurable speed/spin controls with legal limits

## Deliverables

- `docs/GDD.md`
- `docs/feature-spec.md`
- `docs/game-rules-draft.md`
- `math/game-rules-v2.json`

## Exit Criteria

- Feature set frozen for first certification candidate.
- Economy targets agreed with math owner.
- Rules are implementation-ready and runtime-configurable.

## Next

Proceed to [04 Math RNG RTP](04-math-rng-rtp.md).
