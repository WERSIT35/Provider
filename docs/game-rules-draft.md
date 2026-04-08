# Game Rules Draft v1

## Game Type

5x3 video slot with 20 fixed paylines.

## Bet and Wins

1. Player chooses total bet.
2. Game uses 20 fixed paylines.
3. Wins are calculated from payline combinations.
4. Matching symbols must start on reel 1 and continue left-to-right on that line.
5. 3, 4, or 5 matching symbols on a payline can pay.
6. Wild can substitute regular symbols in payline evaluation.
7. Scatter pays are evaluated anywhere on the 5x3 grid.
8. Multiple line wins can occur on a single spin.
9. Highest win per symbol per line is paid.
10. The current profile is tuned for more frequent small and medium wins compared with the initial prototype.
11. Payline symbol payouts are multipliers of line bet; scatter payouts are multipliers of total bet.

## Payout Table (Current Profile)

Line bet multipliers for 3/4/5 of a kind:

| Symbol | 3 | 4 | 5 |
|---|---:|---:|---:|
| 🍒 A | 1.83 | 5.49 | 13.73 |
| 🍋 B | 1.83 | 5.49 | 13.73 |
| 🍇 C | 2.75 | 7.32 | 18.30 |
| 🍀 D | 2.75 | 7.32 | 18.30 |
| 🔔 E | 3.66 | 10.98 | 27.45 |
| 💎 F | 3.66 | 10.98 | 27.45 |
| 🪙 G | 7.32 | 22.88 | 54.90 |
| 👑 H | 9.15 | 32.03 | 91.50 |
| 🌟 WILD | 18.30 | 68.63 | 183.00 |

Scatter payout (total bet multiplier):

| Symbol | 3 | 4 | 5 |
|---|---:|---:|---:|
| 🎯 SCATTER | 18.30 | 91.50 | 457.50 |

## Example Payline Paths

1. Line 1: middle-middle-middle-middle-middle
2. Line 2: top-top-top-top-top
3. Line 3: bottom-bottom-bottom-bottom-bottom
4. Line 4: top-middle-bottom-middle-top
5. Line 5: bottom-middle-top-middle-bottom

## Result Display Requirements

1. Show how many lines were caught on the spin.
2. Show list of caught lines with line number, path, symbol, and amount.
3. Visually highlight winning payline cells on the reel grid.

## Special Symbols

1. Wild
- Substitutes for regular symbols to complete line wins.
- Does not replace scatter.

2. Scatter
- Pays anywhere according to paytable if applicable.
- 3 or more scatters trigger free spins.

## Symbol Legend (Current UI Theme)

- 🍒 A
- 🍋 B
- 🍇 C
- 🍀 D
- 🔔 E
- 💎 F
- 🪙 G
- 👑 H
- 🌟 WILD
- 🎯 SCATTER

## Bonus Rules

1. Free Spins
- Triggered by 3+ scatters.
- Free spins and multipliers are described in feature documentation.
- Retriggers may occur in free spins.

## Important Disclosures

- Game outcomes are determined by server-side RNG.
- Past results do not influence future results.
- RTP is theoretical long-term return over many rounds.
- RTP version shown in game info panel.
- Payline count and line-win rules are shown in game info panel.

## Malfunction Rule

In case of malfunction, bets and wins can be voided according to operator policy and regulation.
