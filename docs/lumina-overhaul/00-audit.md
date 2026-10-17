# Lumina overhaul: audit (step 1)

Every issue found before changing anything, mapped to the overhaul prompt section and to the
code as it stood on `main` at 450cdd8. Spec: `reports/Slot provider UI and motion.md`
(Parts 3, 4, 6, 7). "Step" = the order-of-work step that fixes it.

## A1 · One shared interface

| # | Issue | Where | Step |
|---|---|---|---|
| 1.1 | Three different decks. Vault 20K has the `ps-deck` (menu, info, sound, ticker, Credit/Bet readouts, bet −/+ around a round spin, autoplay popover, turbo, a feature rail on the left). Moth & Lantern has its own `.deck` (info, sound, readouts with Win, a text "Spin" button, autoplay popover, turbo). Relic Forge has a third `.deck` (info, settings, readouts, a text "SPIN" button; no sound button, no autoplay, no turbo). Positions, order, icons and behaviour all differ. | `client/index.html:211-295`, `games/classic-5x3/client/index.html:235-262`, `games/relicforge/client/index.html:247-264` | 2, 3, 5, 6 |
| 1.2 | Three message lines with different behaviour: Vault's `ticker` state machine, `say()` in Moth & Lantern, `say()` in Relic Forge. | `client/main.js:7675-7780`, `games/classic-5x3/client/game.js:62`, `games/relicforge/client/game.js:55` | 2, 5, 6 |
| 1.3 | Three settings and info dialogs: Vault's `ps-modal` (tabs, generated paytable), Moth & Lantern's `<dialog id="info">` (rules plus settings in one), Relic Forge's hand-rolled `#modal`/`#sheet` (rules; settings = one "screen effects" toggle). None has the full menu set (master/music/effects, speed, intro, left-hand, reduced motion, battery saver, history). | `client/index.html:440-570`, `classic game.js:597-625`, `relicforge game.js:377-449` | 3 |
| 1.4 | Relic Forge has no sound control at all, and no haptics. | `relicforge index.html:247-264` | 6 |
| 1.5 | No free-spins HUD that replaces the bet stepper in Moth & Lantern or Relic Forge: Moth & Lantern shows a floating `#fsBadge`, Relic Forge a separate `forge` strip. | `classic game.js:512-523`, `relicforge game.js:319-329` | 5, 6 |
| 1.6 | No session strip, host zone, connection-state ring/message or insufficient-balance state in any game. A slow server shows nothing; an insufficient balance shows only a message after the failed round. | all three | 3 |
| 1.7 | Moth & Lantern's and Relic Forge's Spin is a text label ("Spin"/"SPIN"/"STOP"/"PICK") whose width changes with state (Relic Forge also disables it). | `classic game.js:388-394`, `relicforge game.js:344-352` | 5, 6 |
| 1.8 | Tap targets: Vault's `.ps-icon-btn` is 40 px at phone widths in places; Moth & Lantern's `.icon` is 42 px; Relic Forge's `.icon` is 40 px with 6 px gaps. Below the 44 px hit-area target. | CSS of the three clients | 3 |
| 1.9 | No left-hand mode, no battery saver, no in-game reduced-motion switch (only the OS setting). | all three | 3 |

## A2 · Market rules

| # | Issue | Where | Step |
|---|---|---|---|
| 2.1 | The profile has no `celebrate_threshold`, `max_stake`, `session_hud`, `rtp_display` or `no_input_queue`. (Approved by the owner on 2026-10-17: add the fields and presets; no server-side stake enforcement.) | `platform/src/modules/regulatory/regulatory.ts:25-85` | 4 |
| 2.2 | Presets are UKGC, MGA, SE and DEFAULT only; Ontario, Germany, Spain, Netherlands and New Jersey are missing. The UKGC preset turns buy off, while the research reads buy as allowed but capped by the stake limit. | `regulatory.ts:40-85` | 4 |
| 2.3 | Moth & Lantern ignores the regulatory profile completely: autoplay, turbo and quick stop are always offered and rounds are not paced, so it would break a UK-style profile. | `classic game.js` (no `regulatory` read) | 5 |
| 2.4 | Relic Forge reads only `min_round_ms`. | `relicforge game.js:728` | 6 |
| 2.5 | Vault's Stop (`requestFastStop`, FAST_ZIP) does not check `slam_stop_enabled`. Where slam stop is banned, a press before the result is shown must not shorten anything. | `client/main.js:5115-5141` | 4 |
| 2.6 | Moth & Lantern's quick stop cuts reel landings before the result is shown, unconditionally. | `classic game.js:564-565, 425` | 5 |
| 2.7 | No market line in any Info screen ("Autoplay and quick spin are not available in this jurisdiction"). | all three | 3, 5, 6 |
| 2.8 | No age-banded stake cap: the bet ladder, ante (×1.25) and buy (100× bet) can exceed a £5 / £2 cap. | `client/main.js:7409` (stepBet), buy confirm `5862` | 4 |

## A3 · Sub-stake celebration (losses disguised as wins)

| # | Issue | Where | Step |
|---|---|---|---|
| 3.1 | Vault: the `small` WIN_TIERS row (below 5x, including below 1x) plays `win_small` and a `blast-small` burst. `nice` (5x+) is fine under the rule; `small` below or equal to the stake is not. | `client/main.js:4370-4378`, `playWinLand` `4427-4431` | 4 |
| 3.2 | Vault: every tumble step flies a win chip, plays `explode` and tier sounds, and counts the meter up, judged per step and never against the round total or the stake. | `client/main.js:6540-6585`, `6608-6620`, `6655` | 4 |
| 3.3 | Vault: the ticker turns gold ("WIN: amount") for any win > 0. | `client/main.js:7761-7769` | 4 |
| 3.4 | Moth & Lantern: any line win > 0 lights cells amber, draws the firefly trail, says "Moonlight win: X" in gold and plays `win_small`. With 20 lines most hits are below the stake. | `classic game.js:446-469` | 5 |
| 3.5 | Relic Forge already gates its celebration, but on `total_win >= bet`: a return exactly equal to the stake is celebrated, which the rule forbids (it must be strictly greater). Cluster ignite/burn-away and "Forged:" in gold still play on sub-stake rounds. | `relicforge game.js:516, 593` | 6 |
| 3.6 | None of the three judges the CYCLE stake (bet + ante, or the buy price). | all three | 4, 5, 6 |
| 3.7 | Haptics fire on win events regardless of the threshold. | `client/main.js:265-268`, `classic game.js:52` | 4, 5 |

## A4 · Vault multiplier strike (trade dress)

| # | Issue | Where | Step |
|---|---|---|---|
| 4.1 | `STRIKE`: a crackle at the top of the cell's lane, a bolt, a white-gold flash, and the cell turns into the multiplier. Lightning from above, plus a round winged-sun emblem (`drawWingedSun`), sits too close to a famous competitor's signature beat. | `client/main.js:483-492`, `3181-3290`, `753` | 7 |
| 4.2 | Haptics/sound event named `multiplier_strike` (sound content to be checked against the new reveal). | `client/main.js:267` | 7 |

## A5 · Motion grammar

| # | Issue | Where | Step |
|---|---|---|---|
| 5.1 | Timings are scattered constants in three files with three different turbo models: Vault `TURBO_SCALE` 0.6, Moth & Lantern `speed()` 0.5 (and 0.6 under reduced motion), Relic Forge none. | `client/main.js:212-501`, `classic game.js:45, 408-468`, `relicforge game.js:50, 257-304, 486-507` | 1 (module), 3-7 (adopt REC) |
| 5.2 | Three different big-win ladders: Vault 10/25/50x, Moth & Lantern 10/25/50x (no overlay tiers beyond), Relic Forge 10/50/200x. No 100x tier anywhere. | `main.js:4370`, `classic game.js:454`, `relicforge game.js:496` | 5, 6, 7 |
| 5.3 | Moth & Lantern anticipation keeps firing after the trigger is already reached (it checks `scattersSoFar >= 2`, so 3+ still slows the remaining reels). Rule: only while the trigger can still complete and is not yet complete. | `classic game.js:424` | 5 |
| 5.4 | Moth & Lantern anticipation does not dim non-trigger symbols or pulse the scatters; it only slows and writes "…". | `classic game.js:424-427` | 5 |
| 5.5 | Relic Forge has no anticipation for the Anvil scatters (3 trigger the Forge). Note: its board lands as one drop (all columns at once with a 55 ms stagger), so anticipation must be a column-ordered hold. | `relicforge game.js:256-258` | 6 |
| 5.6 | Count-ups: Vault caps and eases correctly; Moth & Lantern's count is fixed 300/500 ms regardless of win size; Relic Forge jumps. | `classic game.js:455, 471-476`, `relicforge game.js:574` | 5, 6 |

## A6 · Cause and effect

| # | Issue | Where | Step |
|---|---|---|---|
| 6.1 | Vault already has the combine (`Win × Total Multiplier = Total Win`) and souls flying to the badge. Missing: the per-group amount label at the cluster, and a visible sum badge when several multipliers land in one chain (the sum is shown only as the badge total). | `main.js:5324-5404, 5784-5860` | 7 |
| 6.2 | Moth & Lantern: lines are walked only when there is more than one, at most 6, never in turbo; no line number badge; no amount per line; the wild's substitution is not shown; x3 in free spins is never shown (the paid amount just appears). | `classic game.js:459-463` | 5 |
| 6.3 | Relic Forge: no cluster outline (cells only get a `.win` class); no per-cluster amount; no meter charge flight (the meter only pulses after the round); no "Your forge holds N" on load; relic draft is a static modal with no reveal sequence; the chosen relic's effect is not demonstrated. | `relicforge game.js:563-579, 632-640, 452-483` | 6 |
| 6.4 | Relic Forge shakes the board and the cascade counter (`shake()`, `rf-shake`). This breaks the studio-wide no-shake rule. | `relicforge game.js:96-101, 531, 555, 567`, `index.html:121-123` | 6 |
| 6.5 | Relic Forge: from the second round on, the end-of-round message is overwritten. `if (Sound && !S.musicOn) {...} else say(free ? "The hammer rests." : "The forge is cold.")` runs right after `say("Forged: …")`, so a win's message is replaced at once. | `relicforge game.js:593-596` | 6 |
| 6.6 | Buy confirm already shows the price in currency and in × bet (OK). To check in step 4: the debit shows on the balance before the transition, and the price clamps under a market stake cap. | `main.js:5862-5884` | 4 |
| 6.7 | Feature intros and outros differ per game (Vault: feature screen; Moth & Lantern: message only; Relic Forge: banner). No shared transition panel. | — | 5, 6, 7 |

## A7 · Accessibility

| # | Issue | Where | Step |
|---|---|---|---|
| 7.1 | No keyboard Esc on Moth & Lantern's autoplay popover; Relic Forge binds Space/Enter only when the body has focus. | `classic game.js:592-594`, `relicforge game.js:400-403` | 3 |
| 7.2 | No grayscale silhouette check for symbols exists. | — | 8 |
| 7.3 | Reduced motion in Relic Forge shortens every pace to 120 ms (cause steps can become unreadable); Moth & Lantern speeds everything ×0.6. Rule: remove particles/flashes/parallax, keep every cause step. | `relicforge game.js:50`, `classic game.js:45` | 5, 6 |

## A8 · Performance

| # | Issue | Where | Step |
|---|---|---|---|
| 8.1 | No idle-zero probe across games (Vault's rule exists; Moth & Lantern stops its loop; Relic Forge is DOM and idle). | — | 8 |
| 8.2 | No per-game load budget check in CI. | — | 8 |

## Phase 0 (competitor measurement)

Attempted from this environment on 2026-10-17: the provider demo hosts return HTTP 403 through
the session proxy (the research pass hit the same). The "measured" column in
`client/shell/motion.js` stays empty for the owner to fill from an unblocked machine.
