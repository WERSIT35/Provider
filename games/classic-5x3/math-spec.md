# classic-5x3: math specification

Game #2 on the multi-game platform. A classic fruit slot: 5 reels × 3 rows, fixed pay lines, a wild, and scatter free spins with a ×3 multiplier.

The data lives in `math/rules.json`, built by `tools/build-rules.js`. The engine is `engine/engine.js`.

This document is the specification. It contains no claim of certification or approval by any lab or regulator.

## 1. Targets and results

| | Target | Exact (from strips + paytable) | 100M-spin simulation |
|---|---|---|---|
| RTP | 96.0% ± 0.1 | **96.0203%** | **95.9742%** over 100M paid spins, 99% CI [95.8434%, 96.1050%] (`qa/rtp-report.md`) |
| Volatility | medium | — | SD and volatility index in the report |
| Max win | 5,000× total bet | cap enforced by the engine | largest win observed in the report |

The RTP is computed exactly by `tools/exact-rtp.js`; no simulation is needed for it. The simulation confirms the exact figure and measures what the exact figure can't: hit frequency, volatility, the win distribution and the cap.

## 2. Layout and lines

- 5 reels, 3 visible rows. Each reel stops uniformly at random on its strip and shows 3 consecutive cells (the strip wraps).
- Fixed lines. Each variant plays a fixed number of lines; the player can't change it:

| Session game code | Lines |
|---|---|
| `classic-5x3` | 20 |
| `classic-5x3_10` | 10 |
| `classic-5x3_40` | 40 |

- The casino launches the variant it wants, the same way Vault 20K variants such as `bananax_94` work.
- The 40 line patterns are in `rules.json` (`lines.patterns`, a row index per reel). Fewer lines means the first 10 or the first 20 patterns.
- **The bet is the total bet.** Line bet = total bet / lines. Allowed total bets: 0.20, 0.40, 1, 2, 4, 10, 20, 40, 100. The casino's assignment can narrow these.
- **RTP is the same for every line count.** Each reel is independent and uniform, so every visible cell of a reel has the same symbol distribution. Every line therefore has the same win distribution, and the expected line pay per line bet doesn't depend on which lines, or how many, are played. Scatter pays and free spins depend on the total bet only. Hit frequency and volatility do depend on the line count; the report gives them per variant.

## 3. Symbols and pays

Line pays are for 3, 4 or 5 of a kind on a line, left to right starting on reel 1, in **line bets**:

| Symbol | ×3 | ×4 | ×5 |
|---|---|---|---|
| CHERRY | 6 | 20 | 50 |
| LEMON | 6 | 20 | 50 |
| ORANGE | 8 | 25 | 60 |
| PLUM | 8 | 25 | 60 |
| GRAPE | 12 | 40 | 125 |
| MELON | 15 | 50 | 150 |
| BELL | 20 | 75 | 250 |
| BAR | 25 | 100 | 400 |
| SEVEN | 40 | 150 | 800 |

- **WILD** appears on reels 2, 3 and 4 only. It substitutes for every symbol except SCATTER and has no pay of its own. Because it never lands on reel 1, a line's symbol is always reel 1's symbol.
- A line pays its single highest win (only one win is possible per line). Wins on different lines add up.
- **SCATTER** appears once per reel and pays anywhere, in **total bets**: 3 → 3×, 4 → 15×, 5 → 100×. It never forms part of a line win.

## 4. Free spins

- 3, 4 or 5 scatters award 20, 25 or 30 free spins.
- Free spins play at the triggering bet and the same line count, on the same reel strips. **Every free-spin win is ×3**, scatter pays included.
- 3+ scatters during free spins add 20 / 25 / 30 spins (retrigger, no limit).
- The platform locks the bet for the whole feature (the existing feature lock).
- Exact feature figures: triggered 1 in 149.9 paid spins; 23.41 free spins per feature on average (including retriggers); 30.63% of RTP.

## 5. Max win

- A paid spin plus the whole feature it triggers pays at most **5,000× the total bet**.
- The engine carries the feature's running total (`bonus_round_win`, kept on the session by the platform). When a win would cross the cap, the engine pays only up to the cap, ends the feature at once and records a `FREE_SPINS_ENDED_BY_MAX_WIN_CAP` event (`MAX_WIN_CAP` on a base spin).
- The RGS also refuses any single round paying more than the cap (`assertPayable`).

## 6. Reel strips

Symbol counts per reel:

| Reel | Length | CHERRY | LEMON | ORANGE | PLUM | GRAPE | MELON | BELL | BAR | SEVEN | WILD | SCATTER |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 31 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 0 | 1 |
| 2 | 34 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 3 | 1 |
| 3 | 34 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 3 | 1 |
| 4 | 34 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 3 | 1 |
| 5 | 31 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 0 | 1 |

The order of each strip is in `rules.json`. The RTP depends on the counts only, plus one guarantee: a reel never shows two scatters, which holds with one per strip.

## 7. Exact RTP breakdown

| Part | RTP |
|---|---|
| Line wins (base game) | 62.9414% |
| Scatter pays (base game) | 2.4469% |
| **Base game** | **65.3882%** |
| Free spins | 30.6320% |
| **Total** | **96.0203%** |

The free-spins term is: trigger probability × expected spins per feature × 3 × base-game RTP per spin. Expected spins per feature are n₀ / (1 − a), where a is the expected number of spins a free spin adds.

The cap removes a negligible amount; the simulation measures it as cap hits.

## 8. Randomness and replay

- All randomness goes through `crypto.getRandomValues`: one uniform draw per reel, by rejection sampling on 32-bit values, so there is no modulo bias.
- In the RGS that is the seeded, replayable stream (HMAC-SHA256 counter mode). The same seed and pre-spin state (`free_spins_left`, `bonus_round_win`, the variant) reproduce the round exactly.
- The round records the reel `stops`, the `matrix`, every line win and the scatter.

## 9. What the RGS refuses for this game

The game has no feature buy and no ante. A buy request is refused with `FEATURE_BUY_DISABLED`, and an ante request with `ANTE_NOT_AVAILABLE`, before any money moves.
