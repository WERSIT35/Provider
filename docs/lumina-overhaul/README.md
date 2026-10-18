# Lumina overhaul

One shared player interface for all three Lumina games, the market rules on the client, no
celebration of a return at or below the stake, a new Vault 20K multiplier, and motion that
explains every result. Research: `reports/Slot provider UI and motion.md`. Audit:
[`00-audit.md`](00-audit.md). Math, RTP, pays, max win and every id are untouched (the
seeded RTP parity run in CI is the proof).

## What changed

| Area | Before | After |
|---|---|---|
| Interface | Three different decks, three message lines, three settings dialogs | One **Lumina Shell**: the same controls in the same places in every game (`lumina-parity` checks it at 390x844, 844x390, 1440x900) |
| Markets | Platform enforced pacing, reality check and buy; the clients hid autoplay / turbo only in Vault | Every game hides autoplay, speed and buy in place, honours slam stop bans, caps the bet ladder and the buy under the stake cap, paces from the answer |
| Sub-stake wins | Win sounds, bursts and a gold "WIN" for any win above zero | Under `celebrate_threshold: "gt_stake"`: a plain "Credit" line, no win effects; the board still shows what paid (`no-celebrate`) |
| Vault multiplier | A lightning bolt from the top and a winged sun disc | The vault's laser cuts a machined hex plate free, sideways from the frame rail ([storyboards](vault-multiplier.md)) |
| Big-win ladder | Vault 10/25/50x, Moth & Lantern 10/25/50x, Relic Forge 10/50/200x | One ladder in every game: 10 / 25 / 50 / 100x, each game naming its tiers (Vault: VAULT CRACKED, LASER BREACH, MOTHERLODE, CROWN JEWELS) |
| Timings | Constants in three files, three turbo models | One motion table (`client/shell/motion.js`) |
| Idle | Vault redrew at about 20 fps at rest | No frames at rest in any game |
| Explanations | Few | Vault: neutral credit, sum badge (5x + 10x), laser reveal, a multiplier on a winless chain fades with no apply, the total multiplier on the Win label in free spins. Moth & Lantern: lines with amounts, the x3 stamp, the wild fold, line numbers. Relic Forge: the cluster outline and its pay, embers flying into the crucible, anticipation, relic plates engraving in, the plates not taken fading, a callout the first time a relic is taken, the Meltdown explained |
| Features | Vault: a fixed screen; the others: a banner or a ticker line | All three: an intro panel (the rule in one line, the spins), "+N" flying into the spins readout on a retrigger, an outro that counts the feature total (plainly under no-celebrate). Vault: the vault doors close and open on a gold-lit room for the bonus |
| Big wins | A tap closed them at once | A tap lands the count; the title then holds 400-700 ms by tier (`BIG_WIN.hold`); count-ups are log-scaled by × bet (`countUpMs`) |
| Germany | Profile fields only | The panic button (asks first, stops play, `exitRequested { reason: "panic" }` to the casino) and the RTP at the stake |

![Vault 20K on the shell at 9 sizes](img/vault-shell-9-sizes.webp)

## Feature moments

Intro panel (the rule in one line, the spins), the Meltdown explained, the outro counting the
feature total. Vault keeps its framed feature screen with the same content.

![Feature panels in all three games](img/feature-panels.webp)

Vault 20K's bonus scene: the doors close on the board, the room turns gold-lit, the doors open;
on a retrigger "+5" flies into the spins readout (last frame).

![Vault doors and the +N fly](img/vault-doors.webp)

Germany (`?market=DE`): the panic button in the strip (it asks first) and the RTP at the stake.

![DE panic button and RTP at the stake](img/de-market.webp)

The intro at the 9 sizes: [Vault](img/state-vault-feature-9.webp) ·
[Moth & Lantern](img/state-classic-feature-9.webp) · [Relic Forge](img/state-relicforge-feature-9.webp) ·
Vault big win: [9 sizes](img/state-vault-bigwin-9.webp).

## Cause and effect, frame by frame

Frame bursts from the demo build (Vault from `tools/probes/motion-record.js`):
[Vault tumble chain](img/seq-vault-tumble.webp) ·
[Vault multiplier: laser reveal, sum, base × sum = total](img/seq-vault-multiplier.webp) ·
[Moth & Lantern line with its amount](img/seq-lines.webp) ·
[x3 in free spins: base, stamp, tripled](img/seq-x3-stamp.webp) ·
[Relic Forge cluster outline, ember into the crucible, meter +1](img/seq-cluster-meter.webp) ·
[relic draft: plates engrave in, the choice struck in gold, the others fade, the callout](img/seq-relic-draft.webp).

## The shell

`client/shell/shell.js` (served at `/play/shell/`, copied into the demo by `tools/build-demo.mjs`).

```js
const shell = LuminaShell.mount({
  game: "classic",                  // theme key (.lsh[data-game])
  stage: boardElement,              // moved into the frame; the shell never touches inside it
  features: { buy, ante, autoplay, turbo, stop },
  fmt, currency, haptics, build, historyUrl,
  stakeMultiplier: () => 1.25,      // ante raises the cycle stake (bet sheet vs the cap)
  tickerFlash,                      // a game that drives the message line takes the notices
  on: { spin, betStep, betIndex, autoplay(n, { lossX, winX, feature }), autoplayStop,
        info: () => html, buy, ante, pref }
});
```

The returned object: `ticker` (`idle`, `spin`, `win(text, celebrate)`, `neutral`, `say`,
`flash`), `setPhase` (ready / flight / result / tumble / feature / autoplay / wait / broke /
blocked), `setSpinMode` (spin / stop / skip / pick / wait), `setBets`, `setBetLocked`,
`featureHud({ left, win, label, winLabel })`, `waiting`, `notice`, `ask` (blocking),
`panel({ kicker, title, line, stats, total, totalLabel, countX, count, auto })` (feature intro /
outro over the stage; a tap, Enter, Space or Spin continues), `flyPlus("+5")`, `callout(text)`,
`setRtp(pct)`, `anticipationSkippable()`,
`applyMarket(rules)`, `celebrates(roundWin, stake)`, `slamAllowed`, `turboAllowed`,
`autoplayCap`, `setBalance` / `trackBalance` (session strip), `setBet`, `setWin`,
`setAnte`, `setAutoplay`, `setSpeed`, `openMenu`, `openInfo`, `closeSheets`.

Element ids are the same in every game (`spinBtn`, `betDownBtn`, `betUpBtn`, `autoplayBtn`,
`turboBtn`, `psMenuBtn`, `psInfoBtn`, `psTicker`, `footerBalance`, `footerBet`, `footerWin`,
`betSheetBtn`, `buyFreeBtn`, `anteToggle`). Every popup is a VxNotify sheet. A game themes the
shell only through `--lsh-*` tokens. Vault 20K mounts it in `client/vault-shell.js`.

## BoardView

`client/shell/board-view.js` (`LuminaBoardView`): each game's board sits behind five calls,
`mount(host)`, `resize()`, `presentRound(payload, timings)`, `setTheme("base" | "feature")`,
`destroy()`, checked once at `define()`. The round flow (RGS calls, shell, market rules) talks to
the board only through them, so a later renderer port (PixiJS / Spine) replaces only the view.
Vault 20K wraps `ReelCanvasRenderer` + `animateRound`, Moth & Lantern its reel canvas and
`presentRound`, Relic Forge its DOM board and `playRound`.

## The motion module

`client/shell/motion.js` (`LuminaMotion`): every event of the motion grammar with `normal`,
`quick`, `turbo`, `reduced`, a `skip` rule and an empty `measured` column. The values are the
report's recommendations (REC), not measured provider timings: competitor demos were not
reachable from here (see the audit), so the `measured` column waits for a measurement from an
unblocked machine. `ms(event, speed)`, `countUpMs(x, speed)`, `tierFor(x)`, `game(code)` for
each game's physics. Anticipation is never cut short under UKGC / ON
(`anticipation.notSkippableIn`, read through the shell's `anticipationSkippable()`). Reduced
motion (the OS setting or the Menu switch, in every game) removes movement, never a step: Relic
Forge's holds keep their length, Vault's spent multipliers and doors fall back to a fade.

## Market switches

Set per operator on the platform (`PUT /admin/v1/operators/:id/regulatory`, presets in
`platform/src/modules/regulatory/regulatory.ts`); the client reads the session's
`regulatory` block, and a field the RGS leaves out falls back on the jurisdiction
(`LuminaShell.MARKET_FALLBACK`). Illustrative, not legal advice: confirm with the test lab
and counsel before a launch.

| Market | Pace | Autoplay | Speed / slam | No-celebrate | Stake cap | Session strip | Source |
|---|---|---|---|---|---|---|---|
| UKGC | 2.5 s | off | off | yes | £5 (£2 under 25) | net + time | RTS 14D/14E/14F, 8C: VERIFIED |
| ON | 2.5 s | off | off | yes | none | net + time | AGCO 2.15-2.22: VERIFIED |
| DE | 5 s | off | off | yes | €1, buy off | panic button; RTP at the stake | GlüStV §22a, §6i: VERIFIED; a 2026 cap change UNCONFIRMED, not encoded |
| SE | 3 s | on (100) | off | yes | none | balance | SIFS 2022:3: VERIFIED (pace, no queued presses); autoplay ban UNCONFIRMED |
| ES | 3 s | on (100) | off | yes | none | session | UNCONFIRMED (law-firm summary) |
| NL | none | off | off | yes | none | none | UNCONFIRMED (press statements) |
| NJ | none | off | on | no | none | clock + elapsed | N.J.A.C. 13:69O: VERIFIED |
| MGA | none | on (100) | on | yes (Lumina's own policy) | none | none | illustrative |

The client caps stakes only on the client: the RGS does not enforce `max_stake` (agreed:
fields only, no server enforcement in this run).

## Probes

| Probe | What it proves | Where |
|---|---|---|
| `npm run test:motion` | every renderer reads its timings from the motion table | test:client |
| `npm run test:shell` | the shell at 9 sizes: nothing off screen, no overlap, hit areas ≥44 px | test:client |
| `tools/probes/lumina-parity.mjs` | controls identical in all three games (place, size, focus order, name, state); no animation frames for 3 s at rest | test:lumina (CI job lumina-checks) |
| `tools/probes/lumina-audit.mjs` | every game at the 9 sizes: in view, no overlap, hit areas ≥44 px (main) / ≥40 px, labels ≥12 px, text contrast ≥4.5:1 from the real pixels | test:lumina |
| `tools/probes/market-switches.mjs` | UK / DE / default: autoplay, speed, buy and slam as the market says; pacing; DE's panic button (40 px hit) and RTP at the stake, nowhere else | test:lumina |
| `tools/probes/no-celebrate.mjs` | under UK, no round at or below the stake gets a win sound, gold line or overlay; above it still celebrates | test:lumina |
| `tools/probes/symbol-sheet.mjs` | every symbol of every game at 48 px in grayscale (sheet below) | test:lumina |
| `tools/probes/paytable-probe.js` | Vault's displayed pays equal paid pays, all profiles and bets | manual gate |

![Every symbol at 48 px, grayscale](img/symbols-48-grayscale.png)

Review of the sheet: Moth & Lantern separates well by shape. In Vault 20K the crown,
hourglass, ring and chalice share a round medallion and the purple and green triangles share a
silhouette; in Relic Forge the four metal ingots share a shape and differ only by their
engraved sign. Both are art changes, listed as open below.

## Numbers

Measured on the demo build served with gzip (as on real hosting), headless Chrome at 390x844.
Before = `main` before this run's Vault and Relic Forge PRs (Moth & Lantern and Relic Forge were
already on the shell); after = the end of the run. Time to playable on a throttled phone profile
(150 ms RTT, 1.6 Mbps down, 4x CPU); frame times and idle frames without throttling. Budgets
from the report, Part 5.

| | Vault 20K before → after | Moth & Lantern before → after | Relic Forge before → after | Budget |
|---|---|---|---|---|
| Transferred before the game is ready | 0.38 → 0.39 MB | 0.10 → 0.10 MB | 0.37 → 0.37 MB | ≤ 4 MB |
| Game code, gzipped | 166 → 176 KB | 57 → 58 KB | 68 → 71 KB | ≤ 300 KB |
| Time to playable (throttled) | 2.9 → 2.9 s | 1.2 → 1.1 s | 2.5 → 2.6 s | ≤ 6 s |
| p95 frame during a round | 16.8 → 16.7 ms | 16.7 → 16.8 ms | 16.7 → 16.8 ms | ≤ 16.7 ms (mid tier) |
| Frames drawn in 3 s at rest | 181 → **0** | 0 → 0 | 0 → 0 | 0 |

The shell itself is 21.6 KB gzipped (shell.js 10.9, shell.css 5.4, motion.js 4.2, Vault's
mount 1.1), inside its 40 KB budget; the feature panels, Germany and BoardView added about 2.5 KB.

After the feature-moment work (same container, headless Chrome, demo build unless noted):

| | Vault 20K | Moth & Lantern | Relic Forge |
|---|---|---|---|
| 5 s Performance trace at rest: animation frames fired | 0 | 0 | 0 |
| 30-minute soak (turbo, back-to-back rounds): JS heap after GC, start → end | 2.8 → 5.2 MB (1,981 rounds; flat for the last third; `main` grows the same: 2.4 → 4.5 MB in 15 min) | 1.7 → 1.9 MB (738 rounds) | 4.1 → 4.6 MB (954 rounds) |
| DOM nodes / listeners, start → end | 1,611 → 1,664 / 104 → 104 | 402 → 423 / 30 → 30 | 859 → 864 / 29 → 30 |
| p95 frame during rounds at 6x CPU throttle (this branch / `main`) | 50 / 50 ms | 50 / 50-67 ms | 33 / 33 ms |

`npm run bench:client -- --mode mobile` (the real `/play` page, Slow 4G + 4x CPU, 20 rounds):
playable in 3.5 s, 283 KB before playable, p95 frame 16.8 ms while animating, first tap to spin
request 78 ms, 0 taps lost. The 6x-throttle frames come from a container without a GPU (software
compositing), so they show only that this run did not make them worse; the low-end budget still
needs a real phone.

## PRs

#112 research and audit · #114 / #115 the shell · #116 Moth & Lantern on the shell · #117 jurisdiction profile fields · #118 Relic Forge on the shell · #119 Relic Forge animations · #120 Vault market switches and no-celebrate · #121 ambiance retired · #122 Vault multiplier · #123 Vault on the shell, idle zero · #124 old deck CSS removed · #125 probes in CI, session strip, lobby, these docs.

## Open

- **Art:** the silhouette findings above (Vault medallions and triangles, Relic Forge ingots).
- **Germany:** the panic button only asks the casino (`exitRequested { reason: "panic" }`);
  the 24-hour lock itself (OASIS) is the casino's. Relic Forge has no casino bridge yet, so
  there it stops play and says so. The RTP shows as a percentage; whether the lab wants the
  payout per €1 instead is a question for them.
- **Measured timings:** the motion table holds the report's recommendations; the `measured`
  column stays empty until competitor demos can be recorded.
- **IP review:** the new Vault multiplier key frames ([storyboards](vault-multiplier.md),
  `img/vault-laser-reveal.webp`, `img/vault-hex-plates.webp`) wait for your review.
- **Low-end phone:** frame times on a real low-end device (the container has no GPU).
- **Vault demo heap:** about +2 MB over the first 20 minutes of back-to-back play in the demo
  (local engine mode), then flat; the same on `main`. Worth a heap-snapshot look with the
  platform build.
- **Background art:** Vault 20K's temple backdrop has sun-face columns; worth a look in the
  same IP review.
