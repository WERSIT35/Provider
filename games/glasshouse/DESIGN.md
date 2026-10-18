# Glasshouse (code `glasshouse`): design document

Status: **Stage 3 (client) done** (2026-10-18; screenshots `qa/img/`, probe `tools/probes/glasshouse-client.mjs`). Stage 2: `qa/recovery.md`. Lumina Games, game #4. Stage 0 approved by the owner (D1–D6), plus D7–D10 decided during Stage 1.
The math in this document is the shipped math: `math/rules.json` (built by `tools/build-rules.js`), measured in `qa/rtp-report.md`. The client is not built yet.
This document contains no claim of certification or approval by any lab or regulator, and the market table is not legal advice.

Players never see the code `glasshouse`. The player-facing name is **Glasshouse**.

---

## 0. Decisions

D1–D6 were approved with Stage 0. D7–D10 came out of the Stage 1 simulation; D9 was chosen by the owner from three options.

| # | Brief said | Recommendation | Why |
|---|---|---|---|
| D1 | The beam source is a "Prism" | Call it the **Sun Lens** (id `LENS`): a brass-ringed burning lens | Relic Forge already has a special called **Prism**, drawn as "a prism splitting a gold ray" (`docs/brand/relicforge.md`). Two Lumina games with a prism-and-ray symbol breaks "completely different games". |
| D2 | The scatter is a "Rose Window" | Call it the **Glass Rose** (id `ROSE`): a rose flower in leaded glass, in a round brass frame | "Rose window" is a church-architecture term, and the brief bans cathedrals. Same picture, no church word. |
| D3 | Buy "clamped to the stake cap in the UK" | Follow the platform preset: **buy is off in UKGC** (`regulatory.ts` already sets `buy_feature_enabled: false`). If an operator turns it on, the clamp applies, and at 100× bet against a £5 cap, the buy only exists for bets ≤ £0.05, which is below our smallest bet of £0.20. So in practice: off in the UK. | It's the same outcome as the brief, stated honestly. |
| D4 | "Glass chimes, soft bells" | Glasshouse needs **new CC0 recordings** (glass-rub tones, wind chimes, glass harmonica, birdsong). The glass and bell files already in `art-src/audio/` (Kenney `impactGlass_*`, `impactBell_*`, OGA `bell_02`, `item_gem_*`) are used by Moth & Lantern, so Glasshouse may not use them. | "Nothing shared with any other game." Fetching new recordings needs network access to freesound / OpenGameArt from this environment. If that's blocked in Stage 4, I'll stop and tell you rather than reuse files. |
| D5 | (not in brief) | Use the shared **`LuminaBoardView`** seam. When Stage 0 was written it did not exist; `main` added it (#128, `client/shell/board-view.js`) during Stage 3, and Glasshouse registers its board there like the other three games. | One seam for every game; a later renderer port touches only the board. |
| D6 | "Prism symbol (reel 1 only)" | Up to **2 Sun Lenses** can be visible on reel 1 at once (strip spacing guarantees it); never more. | Keeps the board readable: at most two beams, and the rules for two are fully defined (§4.4). In the shipped strips the lenses are far apart, so two never show together; the rules stay defined and tested. |
| D7 | 8 regular symbols | **10**: two more cut gems, Heart and Baguette | With 8 symbols on a 6×4 ways board, 85% of spins won and RTP was ~2,500%. The brief allowed 8–10. |
| D8 | the lens cell lights like any pane | **The Sun Lens is the light source, never a wild pane** | A lit lens made reel 1 wild for every symbol: a beam spin paid ~130 normal spins. As a light source, every symbol still needs a real symbol on reel 1, and a beam spin pays ~34 normal spins. |
| D9 | "lit cells stay wild for the whole feature" | **Lit panes stay lit (and wild) for 2 more free spins, then fade** (owner's choice) | Each extra lit pane makes a free spin ~1.5× richer on 4,096 ways. For the 100× buy, a whole-feature rule would leave more than half of features with no beam at all. With fading panes, about 83% of features show at least one beam. |
| D10 | (not in brief) | **Clear Pane** (id `CLEAR`): plain uncoloured glass, pays nothing, wild when lit; only on reel 1 of the free-spin reels | It lets beams fire often in the feature (the sun coming in through clear glass) while keeping the feature near 96× for the buy. |

---

## 1. Concept

A Victorian glasshouse at sunrise, built of stained glass. Ruby, emerald and sapphire panes are set in charcoal lead came inside a brass frame. When a Sun Lens lands, a beam of white-gold sunlight crosses the board. Mirrors bend it, and every pane it passes through lights up and turns wild. In the free spins the sun climbs to midday, beams come often, and lit panes stay lit for the next two spins, so the house fills with light on a good run.

**Pillars**
1. **The light shows you your wild.** Every wild is explained by a visible beam path. Nothing turns wild without a cause on screen.
2. **Server-made, client-replayed.** The engine computes the beam path and sends it. The client draws exactly that path and never calculates one.
3. **Calm at rest, bright in play.** The board is perfectly still when idle. The only pure light in the game is the beam.
4. **A different game in every sense**: grid, mechanic, palette, fonts, sounds and voice share nothing with Vault 20K, Moth & Lantern or Relic Forge. Only the Lumina Shell (the controls) is common, by design.

| | Vault 20K | Moth & Lantern | Relic Forge | **Glasshouse** |
|---|---|---|---|---|
| Grid | 6×5 | 5×3 | 6×5 | **6×4** |
| Pays | anywhere, tumbles | 20 fixed lines | clusters, cascades | **4,096 ways** |
| Signature | multiplier plates | x3 lantern | meter + relic draft | **sunbeam that turns panes wild** |
| Palette | teal + gold | indigo + amber | parchment + molten gold | **jewel glass + charcoal lead, white-gold light** |

---

## 2. Grid, reels and bets

- **6 reels × 4 rows.** Each reel is a strip. A reel stops uniformly at random and shows 4 consecutive cells (the strip wraps), the same model as Moth & Lantern.
- **Ways:** 4 × 4 × 4 × 4 × 4 × 4 = **4,096 ways**, left to right, starting on reel 1, on adjacent reels.
- **Bet = total bet.** Allowed total bets: 0.20, 0.40, 1, 2, 4, 10, 20, 40, 100 (same ladder as Moth & Lantern; the casino's assignment can narrow it; the market cap clamps it).
- Pays are in **multiples of the total bet, per way** (§3).
- No ante. **Buy feature: yes** (§6).
- Variant game codes (one per RTP, §8): `glasshouse` (96%), `glasshouse_95`, `glasshouse_94`.

### 2.1 Strip constraints (guaranteed by `tools/build-rules.js`, checked by a unit test)

| Rule | Why |
|---|---|
| `LENS` only on reel 1 | The beam always starts on the left edge and travels right. |
| On reel 1, two `LENS` are at least 2 positions apart, and any 4-cell window holds at most 2 | D6: at most 2 beams. |
| `MIRROR_RISE` / `MIRROR_FALL` only on reels 2–6 | A mirror on reel 1 would just bounce the beam off the board. |
| At most 1 `ROSE` (scatter) visible per reel | Scatter count = number of reels showing one (max 6). |
| At most 1 mirror visible per reel | Keeps paths short enough to read in about a second. |
| Strips are built from symbol counts; the order is generated, never hand-edited | Same rule as Moth & Lantern (`rules.json` is built, not written). |

Strip lengths (96% variant): base reels 131, 60, 60, 60, 60, 60; free-spin reels 107, 60, 60, 60, 60, 60. Reel 1 is long so the Sun Lens (1 on the base reel 1) shows on about 1 in 33 base spins; reels 2–6 carry 14 mirrors each (one in every 4–5 cells), so most beams bend. Counts per symbol are in `tools/build-rules.js` (`BASE`, `FREE`, `VARIANTS`).

---

## 3. Symbols and pays

### 3.1 Symbols

Every symbol must be recognisable in a **48 px grayscale render by its silhouette alone** (the `symbol-sheet` probe). Colour is only a second cue.

| Id | Player name | Drawn as (silhouette first) | Tier |
|---|---|---|---|
| `TRILLION` | Trillion | triangular cut gem, point up | low |
| `CUSHION` | Cushion | square cut gem with rounded corners | low |
| `BAGUETTE` | Baguette | long thin rectangular step-cut gem, upright | low |
| `MARQUISE` | Marquise | tall pointed oval (leaf-shaped) cut gem | low |
| `PEAR` | Pear | teardrop cut gem, point up | low |
| `HEART` | Heart | heart cut gem | low |
| `SUNDIAL` | Sundial | brass dial plate with a raised triangular gnomon | high |
| `WATERING_CAN` | Watering Can | brass can, long spout to the right | high |
| `ORCHID` | Glass Orchid | orchid bloom in leaded glass on a stem | high |
| `HUMMINGBIRD` | Hummingbird | hummingbird in profile, long beak, wings up | top |
| `WILD` | (lit pane) | the cell's pane flooded with white-gold light, lead lines still visible | wild (made only by the beam) |
| `LENS` | Sun Lens | round brass-ringed lens with a handle stub on its left, light gathered at its centre | beam source, reel 1 |
| `MIRROR_RISE` | Mirror | a pane of silvered glass at 45°, rising left to right ( ╱ ) | beam bender |
| `MIRROR_FALL` | Mirror | the same pane, falling left to right ( ╲ ) | beam bender |
| `ROSE` | Glass Rose | rose flower in leaded glass inside a round brass frame | scatter |
| `CLEAR` | Clear Pane | plain uncoloured glass in its lead, a faint dawn reflection | pays nothing; wild when lit (free-spin reel 1 only, D10) |

- The six low gems share one ink and differ by cut. Each is also tinted ruby, emerald, sapphire or amber glass, but the **shape** carries the meaning.
- `WILD` is **never on the strips**. A cell is wild only because a beam crossed it (or, in free spins, because it stayed lit, §5).
- The two mirrors are one symbol design in two orientations. The direction of the glass is the whole meaning, so it's drawn bold.
- Lens, mirrors, rose and clear pane do not pay as way symbols (§3.3).

### 3.2 Pays per way, in × total bet

| Symbol | 3 reels | 4 reels | 5 reels | 6 reels |
|---|---|---|---|---|
| HUMMINGBIRD | 2.25 | 2.75 | 4.50 | 5.50 |
| ORCHID | 1.75 | 2.25 | 3.50 | 4.50 |
| WATERING_CAN | 1.40 | 1.70 | 2.50 | 3.50 |
| SUNDIAL | 1.10 | 1.40 | 2.25 | 2.80 |
| HEART | 0.65 | 0.85 | 1.10 | 1.40 |
| PEAR | 0.65 | 0.85 | 1.10 | 1.40 |
| MARQUISE | 0.55 | 0.65 | 0.85 | 1.10 |
| BAGUETTE | 0.55 | 0.65 | 0.85 | 1.10 |
| CUSHION | 0.50 | 0.55 | 0.65 | 0.85 |
| TRILLION | 0.50 | 0.55 | 0.65 | 0.85 |

The curve is flat on purpose: ways already multiply on long runs, and a beam mostly creates long runs, so 6-reel pays are only about 2½× the 3-reel pays. The smallest pay, 0.50× at the smallest bet (0.20), is 0.10 per way.

**Glass Rose (scatter) pays anywhere, × total bet:** 3 → 2×, 4 → 5×, 5 → 20×, 6 → 100×.

### 3.3 How ways are counted (exact)

For each paying symbol S, with `c(S, r)` = number of cells on reel r showing S and `w(r)` = number of wild cells on reel r:

1. `run(S)` = the number of consecutive reels from reel 1 where `c(S, r) + w(r) > 0`. If `run(S) < 3`, S pays nothing.
2. Ways for S = ∏ over reels 1..run(S) of `(c(S, r) + w(r))`.
3. **A way needs at least one real S**, except for HUMMINGBIRD: subtract the all-wild ways, ∏ `w(r)` over reels 1..run(S), from every symbol except HUMMINGBIRD. **A way made only of wild panes pays as Hummingbird.** That way a fully lit board pays the top symbol, once, instead of paying every symbol at once.
4. Win for S = ways × pay(S, run(S)) × total bet. Each symbol's win is computed separately and they add up. The scatter pay is added on top.
5. Lens, mirrors, rose and clear pane are not S. Lit, a mirror or clear pane is wild for pays (§4.5). The lens and the rose are never wild (§4.5).

The engine rounds the same way as the other engines (to cents, per symbol win); the Info dialog shows pays generated from `rules.json` with the same rounding (displayed pays = paid pays).

---

## 4. The Sunbeam (exact rules)

### 4.1 Directions and mirrors

Coordinates: `(row, reel)`, row 0 at the top, reel 0 on the left. A beam has a position and a direction: **R**ight, **U**p, **D**own or **L**eft.

| Beam enters moving | `MIRROR_RISE` ╱ turns it | `MIRROR_FALL` ╲ turns it |
|---|---|---|
| Right → | Up ↑ | Down ↓ |
| Up ↑ | Right → | Left ← |
| Down ↓ | Left ← | Right → |
| Left ← | Down ↓ | Up ↑ |

Any other cell (paying symbol, lens, rose) lets the beam continue straight.

### 4.2 Path (one beam)

1. The beam **starts on its Sun Lens cell** `(row, 0)`, moving Right. The lens cell is lit.
2. Step: move one cell in the current direction.
3. If the new position is outside the 6×4 grid, the beam **ends** (it leaves through the frame).
4. Otherwise the cell is lit. If it holds a mirror, the direction turns per §4.1 (the mirror cell itself is lit).
5. Repeat from 2.

### 4.3 It always ends (loop prevention)

- Mirror paths are reversible: run any beam backwards and it retraces the same cells. A beam could only loop if it re-entered its own start state, the lens cell moving Right. That would mean arriving from the left of reel 1, which is outside the grid. **So no beam can loop**, and every beam ends at the grid edge.
- The engine still guards it: it stops a beam that revisits a `(row, reel, direction)` state, or that passes 96 steps (24 cells × 4 directions), and throws `BEAM_LOOP` (an engine error, never a payout). A unit test proves the guard never fires over every possible board shape that the strips allow.

### 4.4 Two lenses, crossings and shared mirrors

- **Beam order:** beams fire **top to bottom** by the lens row. With two lenses, beam 1 is the upper one.
- **Each beam is computed on the board as it landed.** Beams never change the board for each other: mirrors are not used up, and lit cells don't block or bend anything.
- **Crossing:** two beams (or one beam crossing its own path at a right angle) pass straight through each other. A cell lit twice is just lit.
- **Same mirror:** if both beams hit the same mirror, each bends by §4.1 according to its own direction.
- **A beam that reaches the other lens** passes through it (the lens is transparent).
- **Lit cells** = the union of every beam's cells. The win is evaluated once, after every beam.

### 4.5 What lit means

| Cell holds | When lit, this spin |
|---|---|
| a paying symbol | becomes **WILD** for pays |
| a Clear Pane | becomes **WILD** for pays |
| a mirror | still bends the beam (it already did), and becomes **WILD** for pays |
| a Sun Lens | **never wild** (D8): it is the light source. The beam starts there; the cell is on the path but pays nothing, and it never stays lit in free spins |
| a Glass Rose | **stays a scatter** and still counts. It is never turned wild. The beam passes through (in free spins the pane stays lit afterwards, §5). |

### 4.6 Diagrams

`L` lens, `╱` `╲` mirrors, `*` lit cell, `·` unlit.

**A. Straight beam** (lens on row 1, no mirror in its row): the whole row is lit, so 5 wild cells, one on each of reels 2–6 (the lens itself is not wild).
```
reel:  0 1 2 3 4 5
row 0  · · · · · ·
row 1  L * * * * *   → exits right
row 2  · · · · · ·
row 3  · · · · · ·
```

**B. One bend:** a rising mirror on reel 3 sends the beam up.
```
row 0  · · · * · ·   ↑ exits top
row 1  L * * ╱ · ·
row 2  · · · · · ·
row 3  · · · · · ·
on the path: (1,0) (1,1) (1,2) (1,3) (0,3); wild: the 4 after the lens
```

**C. Three bends and a crossing:** a beam can turn back toward the left and cross its own path.
```
row 0  · * · · · ·   ↑ exits top
row 1  L * ╲ · · ·
row 2  · * * · · ·
row 3  · ╲ ╱ · · ·
```
Path: (1,0) R → (1,1) R → (1,2) ╲ turns Down → (2,2) → (3,2) ╱ turns Left → (3,1) ╲ turns Up → (2,1) → (1,1) (already lit: a crossing) → (0,1) → exits top. Lit: 8 distinct cells. (This board needs two mirrors on reel 2, which the at-most-one-mirror-per-reel rule in §2.1 forbids. It is shown only to fix how crossing works; the engine handles it anyway.)

**D. Two lenses sharing a mirror:**
```
row 0  L * * ╲ · ·      beam 1: R to (0,3) ╲ → Down
row 1  · · · * · ·
row 2  L * * * * *      beam 2: straight along row 2; crosses beam 1 at (2,3)
row 3  · · · * · ·      beam 1 exits the bottom
```

### 4.7 Payload (engine → client)

```json
"beams": [
  { "lens": [1, 0], "path": [[1,0,"R"],[1,1,"R"],[1,2,"R"],[1,3,"U"],[0,3,"U"]], "bends": [[1,3,"R","U"]], "exit": "top" }
],
"lit": [[0,3],[1,1],[1,2],[1,3]],
"wilds": [[0,3],[1,1],[1,2],[1,3]],
"sticky_in": [],
"feature_state": null
```
`path` entries are `[row, reel, direction leaving the cell]` in beam order; `lit` = cells on any path except the lens; `wilds` = lit cells that are wild this spin plus the panes still lit from earlier free spins (`sticky_in`). The client draws exactly this and never computes a path. The payload also carries the usual fields (`stops`, `matrix`, `way_wins`, `scatter`, `total_win`, `free_spins_left`, `bonus_round_win`, `events`, `engine_version`) in the same shape as Moth & Lantern.

---

## 5. Free spins ("Midday")

| Rule | Value |
|---|---|
| Trigger | 3+ Glass Roses anywhere, in a paid spin (or bought, §6) |
| Award | **10 free spins** (same for 3, 4, 5 or 6 roses; the extra roses pay more via the scatter pay) |
| Retrigger | 3+ roses during free spins: **+5 spins**, no limit |
| Bet | locked at the triggering bet (the platform's feature lock) |
| Lit panes | **A pane lit during the feature stays lit (and wild) for the next 2 free spins, then fades** (D9) |
| Free-spin reels | their own strips: reel 1 has 4 Sun Lenses and 10 Clear Panes in 107 cells (a beam on about 1 in 6 free spins); reels 2–6 as the base game |

**Lit panes (exact):**
- The feature carries the lit cells and how many more spins each stays lit: `feature_state = { sticky: [[row, reel], …], ttl: [n, …] }` (`USES_FEATURE_STATE`), so it is server-held and comes back after a reload or a server crash (§9). Both lists are in the same row-then-reel order.
- Each free spin: the reels land on all 24 cells as usual. **A lit cell ignores whatever lands under it**: it is wild for pays, it is not a lens, not a mirror and not a rose, and **a beam passes straight through it** (it doesn't bend there).
- New beams are computed per §4 with lit cells treated as plain glass. After the spin, every cell on a beam's path (the lens excepted) gets `ttl = 2`, including a lit cell the beam crossed again (the light renews it); every other lit cell's `ttl` drops by 1 and it fades at 0.
- So a pane lit on free spin 3 is wild on free spins 4 and 5 and is gone for spin 6, unless a beam crosses it again.
- The trigger spin's lit panes do not carry into the feature. When the feature ends, everything fades.
- If every cell were lit, every way would be wild and pay as Hummingbird at 6 reels (4,096 × 5.5× = 22,528× the bet), so the cap ends the feature (§7). In the Stage 1 simulation no feature came close to a fully lit board (`qa/rtp-report.md`, lit panes at the end).

---

## 6. Buy feature

- Price: **100× total bet**. The free-spin reels are shared by the three variants, so the buy's RTP is the same for all (measured in `qa/rtp-report.md`).
- Buying plays a guaranteed trigger: the engine redraws the base reels until the board shows exactly 3 roses (rejection sampling: unbiased, and the whole draw is in the round's seeded stream, so it replays exactly; about 220 draws on average, `buy_draws` in the payload), pays that board as a normal spin and starts the 10 free spins.
- Confirm sheet shows the price in × bet and in currency; on confirm, the debit shows on the balance, then the feature transition plays (no fake anticipation).
- Hidden in place where `buy_feature_enabled` is false, and clamped under `max_stake` (buy price ≤ cap), per §10.
- `SUPPORTS_BUY = true`, `SUPPORTS_ANTE = false` (an ante request is refused with `ANTE_NOT_AVAILABLE` before money moves).

---

## 7. Max win

- A paid spin (or a buy) plus its whole feature pays at most **5,000× the total bet**.
- Same mechanism as Moth & Lantern: the engine carries the running total in `bonus_round_win`; a win that would cross the cap is paid only up to the cap, the feature ends at once, and the round records `FREE_SPINS_ENDED_BY_MAX_WIN_CAP` (`MAX_WIN_CAP` on a base spin). The RGS refuses any single round paying more than the cap (`assertPayable`).
- Info states the max win as "5,000× bet".

---

## 8. RTP variants and measured math

| Variant game code | Measured RTP (100M paid spins, 99% CI) | How it differs |
|---|---|---|
| `glasshouse` | **96.30%** (95.94–96.65) | reference strips |
| `glasshouse_95` | **94.78%** (94.43–95.13) | +1 Cushion and +1 Trillion on base reels 5–6 |
| `glasshouse_94` | **93.95%** (93.61–94.30) | +1 Cushion and +1 Trillion on base reels 3–6 |
| buy, every variant | **96.30%** (96.15–96.44, 10M buys) | the free-spin reels are shared |

Displayed pays are identical in every variant; only base-reel counts change, never reel 1 (§15 risks). `rules.json` carries these measured figures as `theoretical_percent` / `buy_free_spins_percent`; Info shows the active RTP and the buy RTP from there. The RTP comes from simulation, not an exact sum: the beam makes an exact enumeration impractical.

| Figure (96% variant) | Target in Stage 0 | Measured |
|---|---|---|
| Volatility | medium-high | SD 13.8× per paid spin; features average 96× |
| Hit frequency | 25–30% | **34.5%** (higher than planned: many small 3-reel wins) |
| Sun Lens in the base game | about 1 in 6 (tune) | **1 in 33** (D8: a beam spin is worth ~34 normal spins, so it has to be rarer) |
| Sun Lens in free spins | — | about 1 in 5.5 free spins; 87% of features show at least one beam |
| Feature frequency | 1 in 180–220 | **1 in 205** |
| Free spins share of RTP | 35–45% | **47%** (45.55 of 96.30 points) |
| Average feature | — | 96.2× bet incl. trigger, 10.18 free spins, 0.037 retriggers |
| Max win | 5,000× (cap) | cap reached 2× in 300M paid spins, 34× in 10M buys |

The full report, with the win distribution per variant, is `qa/rtp-report.md` (raw figures in `qa/sim-*.json`), made by `tools/sim-report.js` and `tools/report-md.js`. `tools/rtp-parity.js` is Vault 20K's tool and is not used for this engine; the Glasshouse simulator follows Moth & Lantern's (`games/classic-5x3/tools/sim-report.js`).

Randomness: all through `crypto.getRandomValues` (in the RGS, the seeded HMAC stream), one uniform draw per reel, rejection sampling, no modulo bias. Same seed + `feature_state` + variant reproduce the round exactly.

---

## 9. Platform integration

| Item | How |
|---|---|
| Manifest | `games/glasshouse/game.json`: `code`, `title: "Glasshouse"`, engine files, `rules`, `client`, `presentation: { turbo: true, slam_stop: true }` (the market still switches them off) |
| Engine | `games/glasshouse/engine/*.js`, IIFE on its own namespace `Glasshouse`, same `SpinEngine` shape as the others (`initSession / spin / buyFreeSpins / getRtpProfile / getAllowedBets / MAX_WIN_CAP_X`), `ENGINE_VERSION` recorded on every round |
| Feature state | `USES_FEATURE_STATE = true`: `{ sticky: [[row, reel], …], ttl: [n, …] }` (§5). Not player state: nothing outlives the session's feature |
| Recovery | after reload or a server kill, the feature resumes with the same lit panes, their remaining spins and the spins left. Proven: `bench:chaos` with `BENCH_GAME=glasshouse` (500 players, 3× kill -9: 0 lost rounds, 0 unrefunded debits), `tools/feature-continuity.mjs` (2,852 free spins, 0 state mismatches) and `platform/test/glasshouse.test.ts`; results in `qa/recovery.md` |
| Rules route | `/play/g/glasshouse/rules.json`, launch via `/play?lt=` → `/play/g/glasshouse/` |
| Tests | engine unit tests (`npm run test:glasshouse`, `node:test`, part of `verify:release`): beam table per §4.1, every diagram in §4.6, the loop guard, ways counting incl. the all-wild rule, the lens and rose rules, lit panes fading, cap, triggers, buy, replay, strip spacing, and that `rules.json` is exactly what the builder makes |
| Demo | `/glasshouse/` in `dist-demo/` via `tools/build-demo.mjs`, answered in the page by its own engine like Relic Forge; shared 100,000 play-money balance; lobby tile; "← Lobby" link |

---

## 10. Markets

Values come from the platform presets (`platform/src/modules/regulatory/regulatory.ts`) and the shell's `MARKET_FALLBACK`. Glasshouse adds nothing of its own; it reads the switches. Not legal advice.

| Switch | Default / MGA | UKGC | ON | DE | SE |
|---|---|---|---|---|---|
| Autoplay | on (MGA ≤ 100) | **off** | **off** | **off** | on (≤ 100) |
| Turbo / quick spin | on | **off** | **off** | **off** | **off** |
| Slam stop | on | **off** before the result; skip after it is allowed | **off** | **off** | follows turbo (off) |
| Min round time | none | **2.5 s** | **2.5 s** | **5 s** average | **3 s** |
| Celebrate | any win | **only above the stake** | **only above the stake** | only above the stake | only above the stake |
| Buy feature | on | off (D3) | on | **off** | off |
| Max stake | operator | £5 (£2 under 25) | none | **€1** | none |
| Session strip | — | net + time | net + time | panic-button zone | balance |
| RTP shown | Info | Info | Info | **next to the stake** | Info |

- **No celebration at or below the stake:** a round whose total (a feature's total against what started it; a buy against its price) is at or below its stake keeps every explanation (beam path, lit panes, way highlights, amounts) but has no win sound, no light burst, no gold line and no overlay. The ticker shows the neutral "Credit: amount".
- **Anticipation** only from what has landed: when 2 roses are visible and reels are still to land. It lengthens the remaining reels' landing (shortened in turbo, never removed, not skippable in UKGC / ON). It never appears when 3 roses are no longer possible.
- The beam is part of the result. In markets without slam stop it is never skipped before the result is shown. After the result, a skip only shortens the presentation.

---

## 11. Presentation (motion grammar)

All durations come from `client/shell/motion.js`. Glasshouse adds these rows to `GRAMMAR` (shared, presentation only) and its own block to `GAMES.glasshouse`. Adding rows changes no existing game's timing.

### 11.1 New grammar rows *(tune by eye in Stage 3)*

| Event | Normal | Quick | Turbo | Reduced | Skip | Message |
|---|---|---|---|---|---|---|
| `beamIgnite` | 220 | 170 | 120 | 0 | shorten | "The lens catches the sun" |
| `beamCell` | 60 per cell | 45 | 30 | 0 (the whole path appears at once) | shorten | "The light travels this way" |
| `beamBend` | 120 | 90 | 60 | 0 | shorten | "The mirror turned it" |
| `paneLight` | 180 | 140 | 100 | 180 (no glow, the colour change stays) | shorten | "This pane is now wild" |
| `beamHold` | 300 | 220 | 150 | 400 | shorten | "These are your wilds" (the path stays readable before wins) |
| `stickyCarry` | 250 | 200 | 150 | 250 | no | "Lit panes stay lit" (start of each free spin; a pane on its last lit spin shows dimmer, then fades at the next spin) |

**Reduced motion** removes the glow, the dust motes and the bloom, never a cause step: the full beam path is drawn at once as a thin white-gold line, held at least 400 ms, and then the panes change to wild.

### 11.2 Order of one spin

1. Spin press: first visible response ≤ 80 ms (`spinPress`).
2. Spin-out of the old board, then reels land left to right (`columnGap`, `spinLand`). Anticipation per §10.
3. **All reels have landed.** If any lens is visible: `beamIgnite` on lens 1; the beam draws cell by cell (`beamCell`), a mirror flashes as it bends (`beamBend`), each pane lights as the beam enters it (`paneLight`); then lens 2 the same; `beamHold`.
4. Wins: all winning ways highlight together with per-symbol amounts (`winHighlight`), then the count-up (`countUpMin` … `countUpMax`). The way highlight traces the lit panes so the player sees the wilds took part.
5. Roses: scatter pay, then 3+ → `scatterTrigger` → feature intro.
6. Big win (if any) on the round total.
7. Rest: the board is still, the render loop stops (idle zero).

The beam is drawn only after the whole board has landed, so it never reveals a reel before it lands.

### 11.3 Free spins

- **Transition** (`featureTransition`): the sky behind the glass goes from dawn rose to full midday, the panes brighten one step.
- **Intro panel** (VxNotify, tap to start; auto-continue in autoplay after `featureAutoContinue`): one line of rules plus the count, e.g. "10 spins. Lit panes stay lit for two more spins."
- Each free spin: `stickyCarry` (lit panes glow once to show they kept their light; panes on their last spin are drawn dimmer, and faded panes lose their light first), then the normal order.
- **Retrigger:** the roses flash; "+5" flies into the free-spins counter (`retrigger`).
- **Outro panel** (`featureOutro`, tap to collect): the feature total counts up by tier; it closes the round.

### 11.4 Big win names (shared ladder 10 / 25 / 50 / 100×, judged on the round total)

| Tier | × stake | Glasshouse title |
|---|---|---|
| big | 10× | **Sunlit** |
| mega | 25× | **Radiant** |
| epic | 50× | **Solstice** |
| legendary | 100× | **Zenith** |
| max (cap event) | 5,000× | **Full Bloom** |

### 11.5 House rules kept

No screen or board shake. No idle motion (no float, bob, shimmer or looping dust at rest). No upward wind-up. Every popup through `VxNotify`. No lightning, no orbs, no sky figures. The beam is always horizontal or vertical, travels from the lens, and never comes from the sky.

### 11.6 BoardView (D5)

The board is registered with the shared seam, `LuminaBoardView.define("glasshouse", { mount, resize, presentRound, setTheme, destroy })` (`client/shell/board-view.js`). `presentRound(payload, { bet, stake })` lands the reels on the server's stops, replays the beams and explains the win; `setTheme("feature")` is the midday scene. The round flow, the shell, the RGS calls and the market rules never touch the canvas directly. Canvas2D; a PixiJS port is not part of this game's plan.

The feature intro and outro use the shell's shared panel (`shell.panel`), the retrigger uses `shell.flyPlus`, and the first beam of a visit gets one line of explanation over the board (`shell.callout`: "The light turns every pane it crosses wild.").

---

## 12. Look

### 12.1 Palette

| Name | Hex | Use |
|---|---|---|
| Lead came | `#1E2124` | lead lines, deck, text on light |
| Lead shine | `#4B5158` | lead highlights, secondary text |
| Ruby glass | `#B3263A` | panes, low gem tint |
| Emerald glass | `#1F8A5B` | panes, low gem tint |
| Sapphire glass | `#2457A6` | panes, low gem tint |
| Amber glass | `#C98A2B` | panes, low gem tint |
| Brass | `#B08D57` | frame, lens ring, watering can, sundial |
| Dawn rose | `#F3C9BC` | sky behind the glass, base game |
| Midday sky | `#FFF6E2` | sky behind the glass, free spins |
| **Sunbeam** | `#FFF3CF` core `#FFE38A` | the beam, lit panes, wins: the only pure light, never used at full strength in the background |

Text contrast ≥ 4.5:1 is checked in Stage 5. Light text sits on lead, dark text on glass.

### 12.2 Type (SIL OFL, bundled in `games/glasshouse/client/assets/fonts`, none used by another game)

- **Marcellus** 400: the base outline the logo letters are drawn from, banners, tier titles.
- **Josefin Sans** 600: all other text.
- **Barlow Semi Condensed** 600 (tabular): numbers only.

### 12.3 Board and frame

A greenhouse wall seen from inside: a brass frame with a curved arched top rail and thin glazing bars, panes held in charcoal lead came. Each cell is a pane of glass in its own lead border; the symbol is part of the glass, like a leaded window. The sky behind the glass carries the time of day (dawn in base, midday in free spins). A row of fern and palm silhouettes sits below the frame, outside the board.

### 12.4 Logo

SVG, drawn (not typed): "GLASSHOUSE" as glass letters, each letter a pane in lead came, ruby / emerald / sapphire / amber in turn; one sunbeam passes through the word from the left, lighting the letters it crosses white-gold. Same footprint as the other games' logos; a compact "G" pane mark for very short landscape heights. Sharp from 320 px to 4K (vector only).

### 12.5 Voice (short, themed, no mechanics)

- Idle: "Morning light", "The glass is warm", "Dew on the panes".
- Free spins: "Midday", "The house is filling with light".
- Win: "Sunlit: 12.40".
- Neutral (no-celebrate markets): "Credit: 0.80".
No "4,096 ways", no "lens fires a beam", no rules text on the main screen. All rules are in Info.

---

## 13. Sound

All recordings, CC0 or equivalent free-to-use, none shared with any other Lumina game (D4). Built by `node tools/build-game-audio.mjs glasshouse` into `games/glasshouse/client/audio/` with `manifest.json` and `LICENSES.md`. Music and effects on separate toggles (the shell's menu). The ambience bed sits on the music bus at low level, so it's muted with music. **No sound carries meaning on its own**: every sound has a visual cause on screen.

| Event | Sound |
|---|---|
| UI click / toggle / confirm | small glass taps (a fingernail on a pane) |
| Spin start | soft air swish through the glasshouse door |
| Reel stop | a muted glass pane settling in its lead, panned by reel |
| Lens ignites | a breathy rising glass tone |
| Beam per cell | **a chord built step by step**: each lit cell adds the next note of a glass-rub tone, pitched up a scale; the chord resolves when the beam exits |
| Mirror bend | a bright glass "ting" |
| Pane lights | soft shimmer (layered quietly under the beam chord) |
| Rose lands | a wind-chime cluster |
| Anticipation | sustained glass-harmonica tone that rises |
| Win (small / land / tick) | soft glass bells; a short tick per count step |
| Big win tiers | layered chimes, each tier brighter; Full Bloom adds a birdsong swell |
| Feature award | **bright bloom**: wind chimes + rising glass chord |
| Retrigger | a chime run ending in a bell |
| Feature intro / outro | swell up / settle down |
| Music: base | a gentle greenhouse ambience bed (birds, distant wind chimes) with a soft glass pad |
| Music: free spins | the same bed, brighter, with a slow glass-harmonica melody |

I can't hear audio in this environment. In Stage 4 I will list every sound for you to check on your phone.

---

## 14. Layout

Uses the Lumina Shell unchanged: same controls in the same places as the other games, themed only through `--lsh-*` tokens. The board takes the largest rectangle that leaves the deck and reserved strips intact.

| Viewport | Board | Notes |
|---|---|---|
| 320×568 | 288 px wide → 48 px cells (6×4 = 288×192) | the smallest; symbols must pass the 48 px grayscale test here |
| 360×640, 375×667 | 328 / 343 px wide | |
| 390×844, 430×932 | 358 / 398 px wide | tall phones: the fern band and logo use the spare height |
| 844×390, 667×375 landscape | height-limited, board left, controls in the right rail | logo folds into the rail |
| 768×1024, 1024×768 | centred, larger frame | |
| 1440×900, 1920×1080 | centred, ~70% of the height | |

All: safe areas respected, 16 px gutter, tap targets ≥ 44 px, labels ≥ 12 px, no layout shift between any states (the beam, lit panes and panels are drawn in the board or in overlays outside the flow).

---

## 15. Stage plan and proof

| Stage | Work | Stop? |
|---|---|---|
| 0 | this document | **yes: your approval** |
| 1 | engine, `rules.json`, strip builder, unit tests, ≥ 100M-spin report per variant | **yes: you see the math report** |
| 2 | RGS integration, feature state, recovery test | |
| 3 | board, beam presentation, shell integration, all layouts | |
| 4 | final art and sound | |
| 5 | market profiles, accessibility, performance (≤ 4 MB before first spin, playable ≤ 6 s on Slow 4G + 4× CPU, p95 frame ≤ 16.7 ms during the beam, flat memory over 1,000 spins) | |
| 6 | lobby, demo, README entry, player test script (8 of 10 testers explain the beam unprompted) | |

One PR per stage, tested locally first, merged only when CI is green. Every PR ends with a DONE / NOT DONE list against the brief.

**Known risks**
- **CI time:** the `browser-checks` job was already near its 30-minute limit. Glasshouse's browser checks go in their own job, so they can't push the others over.
- **Sound sourcing (D4)** depends on network access to CC0 libraries.
- **Math:** a beam's value depends strongly on which symbols sit next to the Sun Lens on reel 1 (moving 3 symbols on base reel 1 once moved RTP from 96% to 109%). Reel 1 is therefore never changed between variants, and any future change to it needs a full re-run.
