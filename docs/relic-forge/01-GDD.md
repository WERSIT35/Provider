# Relic Forge — 01. Game design document

Status: draft v0.1 for review (2026-10-17). Lumina Games, game #2. Internal code: `relicforge`.
All numbers marked *(tune)* are starting points; phase 7 (simulation) sets the final values.

---

## 1. Concept

A cluster-pays cascade slot where every spin is a small puzzle that solves itself, and the bonus is a
10-spin run you build by drafting relics.

| Inspiration | What Relic Forge takes |
|---|---|
| Tetris | Cascades and gravity; clearing a full row (Line Burst) is the big moment. |
| Candy Crush | Big clusters leave specials (Rune, Bomb, Prism); adjacent specials combine. |
| Balatro | Score = Base × Mult, built up visibly; relic drafts between spins. |
| Vampire Survivors | Relics level up, two maxed relics evolve; the last spin (Meltdown) is all-out chaos. |

**Pillars**
1. Every outcome comes from the server RNG; the client only shows it.
2. Choices are real but fair: every draft option has the same expected value and differs only in volatility.
3. The number climbing is the show: Base × Mult is always visible and readable.
4. Escalation within a spin (cascades), within a bonus (relics), and at its end (Meltdown).

## 2. Base game

### 2.1 Grid and symbols
- 6 columns × 5 rows. Every cell is an independent weighted draw from the active symbol table (no reel strips,
  no stops, no post-outcome substitution).
- Symbols *(tune counts and weights)*:
  - 4 low: Copper, Iron, Bronze, Silver glyph stones.
  - 4 premium: Ruby, Sapphire, Emerald, Gold relic gems.
  - **Ember**: non-paying, feeds the Forge meter (§2.6).
  - **Scatter** (Anvil): 3+ anywhere after the final cascade trigger the Forge.
  - **Wild**: bonus only (from Ignite); substitutes for any paying symbol.

### 2.2 Cluster pays
- A win is 5+ orthogonally connected cells of the same paying symbol (Wilds join any cluster).
- Pay = paytable value for (symbol, cluster size) × bet, size bands 5, 6, 7–8, 9–11, 12–14, 15+ *(tune)*.
- Several clusters in one evaluation all pay.

### 2.3 Cascade loop
1. Evaluate clusters; pay them (§2.5 scoring).
2. Remove winning cells; create specials (§2.4); collect adjacent Embers (§2.6).
3. Specials created in an earlier step detonate (§2.4).
4. Gravity: each column falls; new cells drop in from the top (same independent draw).
5. Repeat until a step has no cluster and no pending special.

### 2.4 Specials
Created from the size of a winning cluster, on one of that cluster's cells chosen **by the RNG**:

| Cluster | Special | Effect when it detonates |
|---|---|---|
| 7–8 | **Rune** | Clears its whole row and column. |
| 9–11 | **Bomb** | Clears the 3×3 area around it. |
| 12+ | **Prism** | Clears every cell of one symbol type: the paying type with the most cells on the board at that moment (ties → higher-paying type). No RNG, no player input. |

- A special detonates in the cascade step after it was created (spec: "on the next cascade"), whether or not a new
  cluster formed.
- Rune and Bomb keep their symbol type and count towards clusters of that type until they detonate. Prism has no
  type.
- **Cleared cells pay:** the cells a special clears are collected by symbol type. Each type with 5+ collected
  cells pays as a cluster of that size. Fewer than 5 pay nothing. *(Assumption A1, see §9.)*
- **Combos.** When two specials are orthogonally adjacent at detonation, they fuse. Both are consumed and one
  combined effect fires:

| Pair | Combined effect |
|---|---|
| Rune + Rune | Cross: its row and column, from both positions. |
| Rune + Bomb | 3-wide cross (3 rows + 3 columns centred on the pair). |
| Bomb + Bomb | 5×5 area. |
| Prism + Rune/Bomb | Every cell of the Prism's target type becomes that special; they detonate in sequence. |
| Prism + Prism | Full board clear. |

  - Three or more specials in a chain resolve pairwise, in a fixed order: top-left first, then row-major. The order
    is deterministic and documented.
- A special detonation counts as a cascade step (for Mult, §2.5).

### 2.5 Scoring: Base × Mult
- **Mult** starts at ×1 every spin. Each cascade step after the first adds +1. The first evaluation pays at ×1,
  the second at ×2, and so on.
- **Line Burst:** a cascade step that clears at least one full row doubles the running Mult, once per step, from
  that step on.
- Step win = Σ cluster pays in that step × Mult. Spin win = Σ step wins.
- Mult resets at the end of every base spin.
- The round's win is capped at **10,000× bet** (§5).

### 2.6 Forge meter (persistent)
- An Ember is **collected** when it is orthogonally adjacent to an exploding cluster or cleared by a special.
  Each collected Ember adds a fixed fill *(tune, e.g. 2%)*. Uncollected Embers sit as blockers until the spin
  ends.
- The meter is stored **on the server, per player, per game, per bet level**. It survives sessions and devices.
  Switching bet shows that bet's own meter.
- At **100%** the Forge triggers at the end of that spin, and the meter resets to 0.
- **3+ Scatters** also trigger the Forge. The meter is unaffected.
- **Rules change:** a meter is valid only under the rules version (`rules_hash`) it was filled under. If the rules
  change, meters reset, and the change is disclosed in the rules and release notes. *(Assumption A2.)*
- The rules screen discloses all of this (§7).

## 3. Bonus: The Forge

### 3.1 Flow
- 10 free spins at the triggering bet. The bet, ante and currency are locked (the existing feature lock).
- **Before each spin, draft 1 of 3.** The server generates the offer by RNG at the end of the previous spin (or
  of the trigger spin), stores it, and sends it to the client. The player's pick is sent with the next spin
  request. The server validates it against the stored offer and records it on the round.
- **Offer rule:** 3 different relics, drawn uniformly from relics that are not at Lv3 and not consumed by an
  evolution. At least 3 such relics always exist: 10 picks can max at most 3 of the 6 relics.
- Picking a relic already held levels it up (max Lv3).
- **Autoplay** stops at the Forge. The existing "stop when Free Spins are won" behaviour is forced on.
- **Abandoned bonus:** the bonus resumes on the next session (feature lock). If an operator closes the game,
  missing picks default to the left-most offer. Every option has the same EV (§4), so the default costs the
  player nothing in expectation. The rules disclose this.

### 3.2 Relics (Lv1 / Lv2 / Lv3) *(tune)*

| Relic | Lv1 | Lv2 | Lv3 |
|---|---|---|---|
| **Ignite** | 1 Wild placed on a random cell (RNG) each spin | 2 Wilds | 3 Wilds |
| **Chain** | +2 Mult per cascade (instead of +1) | +3 | +4 |
| **Expand** | +1 row (6 rows) | +2 rows (7) | +3 rows (8, max) |
| **Magnet** | Specials stay on the board for 2 spins (they detonate again each spin) | Also: clusters of 6 make Runes | Specials stay 3 spins |
| **Hoard** | Removes the lowest low-pay symbol from the draw table | Removes 2 lows | Removes 3 lows |
| **Surge** | Mult does not reset between free spins | Carried Mult also +1 at each spin start | Line Burst is ×3 |

### 3.3 Evolutions (both relics at Lv3 → fuse, replacing both)

| Evolution | From | Effect |
|---|---|---|
| **Inferno** | Ignite + Chain | Ignite Wilds carry ×2, and Wilds in the same cluster multiply each other (×2·×2·…). Chain Lv3 stays. |
| **Cathedral** | Expand + Hoard | 8-row grid, premium symbols only (no lows). |
| **Singularity** | Magnet + Surge | Specials and Mult persist for all remaining spins. |

- An evolution plays a 1.5 s full-screen moment, skippable after a player's first view of it.

### 3.4 Meltdown (spin 10)
- **Every relic effect fires at once.** Owned relics and evolutions fire at their own levels. Relics the player
  does not own fire at Lv1. *(Assumption A3.)* The client shows them firing in a fixed sequence, then the board
  resolves.

### 3.5 Bonus scoring
- Spin win = Σ (cluster value × Mult) × **Relic bonus**.
- **Relic bonus** is the bonus's running factor: the product of the per-pick factors that make every draft option
  equal in EV (§4). It is always ≥ ×1.00, shown next to Mult, and builds up Balatro-style:
  Base → × Mult → × Relic bonus → Win.

## 4. Fair choice: equal-EV drafts

**Rule (user decision 2026-10-17, strict):** at every draft, all three options have the same expected value for the
rest of the bonus, within tolerance. The bonus's EV, and so the game's RTP, does not depend on how the player
picks. Options differ only in **variance** (volatility).

How it works for the player:
- Each offer card shows the relic, its next level, and a **Volatility** rating (Low / Medium / High). The rating
  comes from the per-state variance table.
- Each pick sets a small **Relic bonus** factor. Picks that make the rest of the bonus richer get a smaller factor;
  leaner picks get a larger one. Expected value comes out equal, while the swing differs.

The method, its tolerance and how it is proven are in `02-tech-plan.md` §4.

## 5. Math targets

| Target | Value |
|---|---|
| RTP profiles | 96.0% (`relicforge`), 94.0% (`relicforge_94`), 92.0% (`relicforge_92`) |
| RTP split | ~55% base / ~45% bonus |
| Hit frequency | ~28% (rounds with any win) |
| Bonus frequency | ~1 in 180 spins (scatter ≈ 1/300 + meter ≈ 1/450 *(tune)*: 1/300 + 1/450 = 1/180) |
| Volatility | High (index reported by the sim) |
| Max win | 10,000× bet, hard cap, enforced by the engine and again by the RGS |
| Draft fairness | Every offer's options equal in EV within tolerance |

**Derived (at 96%):**
- Bonus RTP share = 0.45 × 96% = 43.2% of bet per spin. At 1/180, the average bonus must pay
  43.2% × 180 ≈ **77.8× bet**.
- Base game RTP ≈ 0.55 × 96% = **52.8%**.

**Persistent-meter RTP:** RTP is a long-run figure over continuous play at one bet. A player who stops with a
part-filled meter keeps it, and it is still there next time. Short sessions measured from an empty meter return
less than RTP; the meter holds the difference. The sim reports RTP by session length and the stationary meter
distribution.

## 6. Compliance design (GLI-11 style)

| Requirement | Mechanism |
|---|---|
| Outcomes from the server RNG only | The engine draws only from `crypto` (the seeded RGS controller). The client is display-only in RGS mode. The Vercel demo resolves in the browser and is labelled **Demo**. |
| No engineered near-misses | Independent per-cell draws. Specials' cell, Ignite Wilds and offers come from the RNG. Nothing is placed or substituted after an outcome is known. |
| No losses disguised as wins | No celebration, rising pitch, Mult colour climax or win-tier screen when a base round pays less than the total bet, or a bonus pays less than the trigger bet. The amount is still shown plainly. |
| No slam-stop / turbo by default | Both are off for Relic Forge, behind per-market flags (`turbo_enabled`, new `slam_stop_enabled`), which are off unless enabled. |
| Persistent meter disclosed | The rules screen covers storage per player and bet, reset rules, rules-change policy and the trigger. The meter is always visible. |
| Player choice disclosed | The rules say every option has the same EV and differs only in volatility, and explain how the abandoned-bonus default works. |
| Max win enforced server-side | The engine cap covers trigger + bonus. The RGS also checks with `assertPayable`. |
| Replayable | Seed, pre-state (incl. meter, feature state, pick) and `rules_hash` are recorded on every round. The signed export covers them. |
| No certification claimed | Nothing may say "certified" until a lab certificate exists. |

## 7. Player-facing rules (draft text)

- **Forge meter:** "Embers next to a winning cluster, or cleared by a special, fill the Forge meter. Your meter is
  saved for you, separately for each bet size, and stays between visits. At 100% the Forge starts and the meter
  empties. If the game's rules are updated, saved meters are reset."
- **Relic choices:** "Before each Forge spin, choose 1 of 3 relics. All three choices are worth the same on
  average; they differ in how much the result can swing. The Relic bonus shown on screen is how this is balanced."
- **Unfinished Forge:** "If you leave during the Forge, it continues when you return. If the game has to finish it
  for you, the first relic of each choice is taken."
- **Max win:** "Wins are capped at 10,000× the bet per round, including the whole Forge. When the cap is reached,
  the round ends."

## 8. Juice (presentation)

All of this is a pure function of the round payload. The client never alters outcomes, and `Math.random()` is
used only for cosmetic effects.

- **Cascade pitch:** each cascade step's sound rises one step on a fixed ladder (max 8 steps). It is flat when the
  round total is below the total bet.
- **Combo counter:** shows the cascade count, grows with each step, and shakes from step 3 (an element-level
  shake).
- **Mult:** pulses on change. Its colour ramps through the tiers ×1–4 neutral, ×5–9 amber, ×10–24 orange,
  ×25+ white-hot *(tune)*. The climax tiers are suppressed under the losses-disguised-as-wins rule.
- **Evolution:** a 1.5 s full-screen moment, skippable after its first view (remembered per player on the device).
- **Meltdown:** a board-level shake (the board container only, never the page layout), then each relic fires in
  sequence.
- **Reduced motion and the Settings toggle:** under `prefers-reduced-motion`, or with "Screen effects" off, there
  is no shake and pulses become a colour change only.
- **Sound hooks:** `cascade_step(n)`, `special_create(kind)`, `special_detonate(kind)`, `combo(kind)`,
  `line_burst`, `mult_tier(t)`, `ember_collect`, `meter_full`, `draft_open`, `relic_pick(relic, level)`,
  `evolution(kind)`, `meltdown_start`, `meltdown_fire(relic)`, `win_tier(t)`, `max_win`.

## 9. Design assumptions to confirm

| # | Assumption | Why it matters |
|---|---|---|
| A1 | Special-cleared cells pay as clusters per type (5+). | Without this, specials only reshape the board. With it, Prism and full clears are the big wins. |
| A2 | The meter resets when `rules_hash` changes. | Keeps replay exact and liability bounded. |
| A3 | Meltdown fires every relic, with unowned relics at Lv1. | The alternative is owned relics only, which makes Meltdown weaker. |
| A4 | Line Burst doubles the running Mult (from that step on), once per step. | The alternative is doubling only that step's pay. |
| A5 | No feature buy and no ante. | A buy would need its own RTP and its own EV-equal analysis. |
| A6 | Bet levels match Vault's (0.20 … 500). | The meter is stored per bet level. |
