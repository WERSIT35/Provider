# Feature Specification v2

## Scope

Defines gameplay features for implementation and testing of the current Banana X profile build.

## Base Game Features

1. Layout and Win Model
- Grid: `5x4`
- Win model: symbols pay anywhere
- Minimum match count: `8`
- Payout groups: `8-9`, `10-11`, `12-30`

2. Symbol Set
- Regular symbols:
  - `TOP_CROWN`
  - `HOURGLASS`
  - `RING`
  - `CHALICE`
  - `RED_GEM`
  - `PURPLE_TRIANGLE`
  - `YELLOW_HEX`
  - `GREEN_TRIANGLE`
  - `BLUE_DIAMOND`
- Special symbols:
  - `MULTI` (wild multiplier)
  - `SCATTER`

3. Tumble Sequence
- Winning symbols are removed.
- Remaining symbols collapse downward.
- Empty cells refill from top.
- Sequence continues until no new win forms.

4. Multiplier Behavior
- `MULTI` symbols can appear in base and bonus rounds.
- Allowed values are config-driven in rules payload.
- Sequence multiplier accumulation must count each multiplier symbol once.

## Bonus Features

1. Free Spins
- Trigger condition: `4+` scatters in base game.
- Base award: `15` spins.

2. Free Spin Retrigger
- Trigger condition during free spins: `3+` scatters.
- Retrigger award: `+5` spins.

3. Persistent Bonus Multiplier
- In free spins, winning multipliers can accumulate persistently.
- Session caps are enforced by backend risk controls.

## RTP and Economy Profiles

- `bananax`: `96.38%`
- `bananax_94`: `94.40%`
- `bananax_92`: `92.38%`
- Volatility: high
- Max win cap: `20000x`

## UX Categories

- Win-tier visual classes are determined by sequence strength (`small` / `medium` / `great`).
- Last 10 Spins panel displays both resolved spins and event messages.

## Configuration Source

- Runtime source of truth: `math/game-rules-v2.json`

## Out of Scope

- Persistent missions
- Progressive jackpots
- Tournament mode
