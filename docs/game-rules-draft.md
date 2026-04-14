# Game Rules Draft v2

## Game Type

`5x4` video slot with symbols-pay-anywhere win model.

## Bet and Wins

1. Player chooses total bet.
2. Matching symbols are counted anywhere on the grid.
3. Minimum `8` matching symbols are required for a symbol win.
4. Payout tiers are grouped by `8-9`, `10-11`, and `12-30` matches.
5. Scatter pays are evaluated anywhere on screen.
6. Multiple symbol wins in one result are summed.
7. All payouts are expressed as total-bet multipliers.

## Core Result Flow

1. Spin resolves server-side.
2. Winning symbols are paid and removed.
3. Remaining symbols drop.
4. New symbols refill from top.
5. Tumble repeats until no new wins are formed.

## Special Symbols

1. `MULTI` (wild multiplier)
- Can appear in base game and free spins.
- Uses configured allowed multiplier values.
- Must not be double-counted within the same winning sequence.

2. `SCATTER`
- Pays anywhere by scatter table.
- `4+` scatters trigger Free Spins.

## Bonus Rules

1. Free Spins
- Triggered by `4+` scatters in base game.
- Base award: `15` free spins.
- Retrigger: `3+` scatters awards `+5` free spins.
- Persistent multiplier progression applies in bonus flow.

## Economy and Limits

- Volatility: `High`
- RTP profiles:
  - `bananax`: `96.38%`
  - `bananax_94`: `94.40%`
  - `bananax_92`: `92.38%`
- Bet range: `0.20` to `125.00`
- Max win cap: `20000x` bet

## Transparency Disclosures

- Outcomes are determined by server-side RNG.
- Past results do not influence future outcomes.
- RTP is a theoretical long-term value.
- Active profile and rules are exposed through the rules API.

## Malfunction Rule

In case of malfunction, all plays and pays may be voided according to operator policy and regulation.
