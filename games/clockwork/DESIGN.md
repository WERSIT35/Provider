# Clockwork Menagerie: game design (code `clockwork`)

Game #5. A toymaker's workshop at night: brass clockwork animals and parts behind a smoked-glass
board. This file is the specification; `math/rules.json` is the data (built by
`tools/build-rules.js`, never hand-edited); `engine/engine.js` implements it. Section numbers
are referred to from the engine and the tests.

## 1. Targets (set by the owner, 2026-10-20)

| | |
|---|---|
| Grid | 5 reels × 3 rows |
| Pays | 20 fixed lines, both ways |
| RTP variants | 96 % (`clockwork`), 94 % (`clockwork_94`), 92 % (`clockwork_92`) |
| Volatility | high |
| Max win | 10,000× the bet, covering a whole round (a paid spin with its respins, or a feature with its trigger) |
| Feature buy | 100× the bet, RTP the same as the 96 % variant in every variant |

## 2. Symbols

| Tier | Ids (art names) |
|---|---|
| High | `OWL` (top), `FOX`, `HARE`, `TORTOISE` |
| Low | `GEAR`, `SPRING`, `NUT`, `SCREW`, `WRENCH` |
| Wild | `KEY`: the wind-up key; only on reels 2, 3 and 4 |
| Scatter | `BOX`: the music box; on every reel, at most one in view per reel |

Strip rules (checked by the builder and the tests): at most one `KEY` and one `BOX` in any
3-cell window of a strip, and `KEY` never on reels 1 or 5.

## 3. Line wins, both ways

- The bet is split over the 20 lines (`line bet = bet / 20`); line pays are in line bets
  (`math/rules.json` `paytable`, for 3, 4 and 5 of a kind).
- **Left to right:** reel 1's symbol plus each next reel showing it or a wild, 3 or more in a row.
- **Right to left:** reel 5's symbol plus each reel before it showing it or a wild, 3 or more.
- A line paying 5 of a kind pays once (left to right only). Otherwise a line can pay in both
  directions in the same spin (e.g. 3 owls from the left and 3 gears from the right).
- Reels 1 and 5 never show a wild, so a line's paying symbol is always a real symbol. The wild
  pays nothing on its own.
- Line wins are multiplied by the line's multiplier (§5.2; 1 in the base game).

## 4. Wound Wild (base game respins)

1. A `KEY` that lands on reel 2, 3 or 4 **winds its reel**: the whole reel becomes wild
   (`wound`), with a gauge of 2 respins.
2. The spin pays (§3), then a **respin** follows at no cost: wound reels stay, the other reels
   spin again. Each respin pays on its own and uses up one turn of every wound reel's gauge.
3. A `KEY` landing during a respin winds its reel too, with a fresh gauge of 2.
4. Respins continue while any wound reel has turns left. A reel whose gauge reaches 0 unwinds
   and spins normally again.
5. Music boxes on any of these boards count (§5.1): 3 or more on one board trigger the free
   spins after the respins end. Scatter pays (§5.1) pay on the board that shows them.
6. All of it is one paid round (one debit, one credit): the round's win is the sum of every board.

## 5. Free spins

### 5.1 Trigger and scatter pays

3, 4 or 5 `BOX` symbols anywhere on one board pay 2×, 10× or 50× the bet and award 8, 12 or 16
free spins. In the feature, 3 or more add 4 spins.

### 5.2 Wound reels stay, multipliers grow

- A `KEY` landing in the feature winds its reel for **the rest of the feature** (no gauge).
- A wound reel carries a multiplier: ×1 on the spin it is wound, then +1 on every following
  free spin, up to ×5.
- A line win's multiplier is the **sum** of the multipliers of the wound reels inside its
  winning run (the reels that make the win; a wound reel past the end of the run does not
  count). A run through no wound reel: ×1. Example: a 4-reel win through reels 2 (×3) and 4
  (×1) → ×4; the same line paying only 3 reels → ×3.
- One spin's line wins can reach 9,750× the bet at most (every middle reel wound at ×5, the top
  symbol on every line), so the 10,000× cap is reached only across a feature.
- Wound reels and their multipliers ride on `feature_state` = `{ wound: [[reel, mult], ...] }`,
  so a reload or a server restart resumes the feature exactly.
- There are no respins in the feature.

### 5.3 End

The feature ends when its spins run out, or at the max win (§1). Its total (trigger round
included) is reported in `bonus_round_win`.

## 6. Feature buy

100× the bet: a base board conditioned on exactly 3 music boxes (drawn by rejection: redraw
every reel until the board has exactly 3, unbiased and replayable). That board pays as usual
(no respins on a buy board), then the feature plays. The free-spin reels are the same in every
variant, so the buy RTP is the same in every variant.

## 7. Variants

One strip set per variant; the 94 % and 92 % sets add low symbols to the **base** reels only.
The paytable, the free-spin reels and the buy are the same in all three.

## 8. RTP proof

Simulated, not exact (respins and growing multipliers make an exact sum impractical):
`node games/clockwork/tools/sim-report.js --spins 100000000 --variant <id>` per variant and
`--mode buy` for the buy, seeded and sharded (machine-independent); the reports go to
`qa/rtp-report.md`. Not lab-certified.

## 9. Presentation notes (client)

- Smoked-glass board on the workshop background; the free spins use the night workshop.
- A wound reel shows the full-reel wind-up column art with its gauge (base: turns left;
  feature: the reel's multiplier).
- No mechanics text on the main screen; the rules live in the Info sheet, generated from
  `rules.json` (displayed pays = paid pays).
