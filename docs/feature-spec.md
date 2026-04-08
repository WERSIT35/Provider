# Feature Specification v1

## Scope

Defines gameplay features for implementation and testing.

## Base Game Features

0. Symbol Set (Current Theme)
- Regular symbols:
  - `A` = 🍒
  - `B` = 🍋
  - `C` = 🍇
  - `D` = 🍀
  - `E` = 🔔
  - `F` = 💎
  - `G` = 🪙
  - `H` = 👑
- Special symbols:
  - `WILD` = 🌟
  - `SCATTER` = 🎯

0.1 Payout Values (Current Profile)
- Line symbol payouts use line bet multiplier.
- Scatter payouts use total bet multiplier.

| Symbol | 3 | 4 | 5 |
|---|---:|---:|---:|
| 🍒 `A` | 1.83 | 5.49 | 13.73 |
| 🍋 `B` | 1.83 | 5.49 | 13.73 |
| 🍇 `C` | 2.75 | 7.32 | 18.30 |
| 🍀 `D` | 2.75 | 7.32 | 18.30 |
| 🔔 `E` | 3.66 | 10.98 | 27.45 |
| 💎 `F` | 3.66 | 10.98 | 27.45 |
| 🪙 `G` | 7.32 | 22.88 | 54.90 |
| 👑 `H` | 9.15 | 32.03 | 91.50 |
| 🌟 `WILD` | 18.30 | 68.63 | 183.00 |
| 🎯 `SCATTER` (total bet) | 18.30 | 91.50 | 457.50 |

1. Standard Line Wins
- Left-to-right line evaluation on 20 fixed lines.
- Minimum match: 3 of a kind (except special symbols).

2. Wild Symbol
- Substitutes all regular symbols.
- Does not substitute scatter.

3. Expanding Wild Reel (Random Modifier)
- Chance to trigger per base spin (math-controlled).
- One randomly selected reel expands to full wild.
- Applies before line evaluation.

## Bonus Feature

1. Free Spins
- Trigger condition: 3, 4, or 5 scatters on paid spin.
- Awards:
  - 3 scatters: 10 free spins
  - 4 scatters: 14 free spins
  - 5 scatters: 20 free spins

2. Free Spin Multiplier
- Global multiplier starts at x2 for free spin session.
- On retrigger, increase multiplier by +1 (max x5).
- Multiplier applies to line wins and wild wins.

3. Retrigger Rules
- 3+ scatters during free spins awards +5 spins.

## Payout UX Categories

- Normal Win: < 10x bet
- Big Win: >= 10x and < 25x
- Mega Win: >= 25x and < 75x
- Ultra Win: >= 75x

## Configuration Flags

- `feature.expandingWild.enabled`
- `feature.freeSpins.enabled`
- `feature.buyFeature.enabled` (default: `false`)

## Out of Scope for v1

- Bonus buy
- Persistent missions
- Progressive jackpots
- Tournament mode
