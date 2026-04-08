# 03 Game Design (Features + Player Economy)

## Goal
Define a fun, clear, and commercially viable slot design before coding.

## Core Design Targets

- Reel setup: 5x3 (initial recommendation)
- Volatility: Medium-high (initial)
- RTP target: 93.50% to 94.50% primary build
- Max win target: x5,000 to x10,000 (choose after math simulation)
- Session feel: frequent small reinforcement + occasional meaningful bonus excitement
- Profitability rule: release candidate must pass repeated 1,000,000-spin checks with positive casino net.

## Tasks

1. Write GDD (`docs/GDD.md`) with:
   - Theme and fantasy
   - Symbol set
   - Pay mechanics
   - Wild/scatter behavior
   - Bonus feature flow
   - UI states and win presentation
2. Define feature stack:
   - Base game feature(s)
   - Main bonus feature
   - Optional ante-buy / feature buy only if legal in target markets
3. Economy controls (to feed math):
   - Hit frequency range
   - Bonus trigger frequency range
   - Win distribution goals
   - Dead-spin tolerance
4. Responsible design:
   - No deceptive UI
   - Clear rules and payout disclosures
   - Configurable speed/spin controls with legal limits

## Deliverables

- `docs/GDD.md`
- `docs/feature-spec.md`
- `docs/game-rules-draft.md`

## Exit Criteria

- Feature set frozen for first certification candidate.
- Economy targets agreed with math model owner.
- Rules are implementation-ready.

## Next

Proceed to [04 Math RNG RTP](04-math-rng-rtp.md).
