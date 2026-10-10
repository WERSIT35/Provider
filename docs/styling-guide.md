# Styling Guide — Vault 20K (v10)

## Direction

**Lumina Games — Vault 20K.** Cinematic noir heist: a vault at night, brushed steel, warm
tungsten work lights, a red security laser, and gold for wins. Premium and calm: light and sound
carry the impact, never camera movement.

## Tokens (`client/styles.css` `:root`; mirrored into canvas via `THEME` in `main.js`)

| Group | Tokens |
|-------|--------|
| Surfaces | `--bg-vault-door` #07080A, `--bg-gunmetal` #111418, `--bg-panel` #191D22, `--bg-panel-raised` #22272E |
| Steel | `--steel-edge` #3A414A, `--steel-brushed` #6B7480, `--steel-sheen` #B7BFC9 |
| Light | `--tungsten` #FFB86B, `--tungsten-soft` #FFD9A8 |
| Laser | `--accent-laser` #FF2A3A, `--accent-laser-deep` #A30A16, `--accent-laser-hot` #FF7A84 |
| Wins | `--win-gold` #F2C14E, `--win-gold-bright` #FFE7A3, `--win-gold-deep` #9C6B12 |
| Text | `--text-hud` #EEF1F4, `--text-muted` #8E98A4, `--text-dim` #5A636E |
| Win tiers | `--tier-nice`, `--tier-big`, `--tier-mega`, `--tier-epic`, `--tier-max` |
| Multiplier rarity | `--mult-common` → `--mult-legendary` (cold steel → hot laser) |

| Win aura | `--aura-crown`, `--aura-hourglass`, `--aura-ring`, `--aura-chalice`, `--aura-red`, `--aura-purple`, `--aura-yellow`, `--aura-green`, `--aura-blue` (read by `THEME.aura`; scatter = laser, multiplier = bright gold) |
| Glass | `--glass-fill` (blur available), `--glass-fill-solid` (no blur), `--glass-edge`, `--glass-sheen`, `--glass-shadow`, `--glass-blur` |

CSS is the source of truth: `THEME` reads the computed tokens at boot, so canvas and DOM can
never drift apart.

## Frameless glass (v10)

- **No painted reel frame.** The canvas is transparent. `buildStageCache` bakes only a small
  dot with faint cross arms where four cells meet. The board surface is CSS glass on
  `.reels-stage`: a dark fill, a backdrop blur, a 1px `--glass-edge` and `--glass-shadow`.
  The canvas does not clip to an inner table any more; the glass edge is the board edge.
- **Wins light up instead of getting boxed.** Each winner gets a halo in its symbol's aura
  colour, plus an additive inner glow over the art. Both breathe with the celebration
  pulse, and the swell peaks at 5% (`MOTION.breathBase` + `breathDepth`).
- **Floating HUD.** The deck keeps its grid and height, but the full-width bar is gone.
  System buttons and the ticker/readouts are dark-glass pills; the spin cluster floats.
  The bonus "Total Multiplier" badge and Ante Bet use the same glass.
- **Blur only where it is cheap.** `perf-handheld` / `perf-low` strip every
  `backdrop-filter`. There, and in browsers without it, `--glass-bg` switches to
  `--glass-fill-solid`.
- Glass edges are colour on existing borders or box-shadows only, never a new border
  width, so the zero-reflow contract still holds.
- `node tools/probes/ui-shot-probe.js` captures idle and win shots at desktop, landscape
  and portrait sizes for review by eye.

**Fonts** (local, `client/assets/fonts/`): `Vault UI` (Inter, variable) for UI text,
`Vault Display` (Oswald, variable) for headings, labels and the big-win overlay.

## Layout: the player shell

A CSS named-area grid ("PLAYER SHELL" in `styles.css`) on `.vault-shell`:

- **Desktop / landscape:** `"left center right" / "deck deck deck"`. Left: Buy Feature + Ante
  Bet. Centre: the board. Right: art slots (game logo, character). Deck: system buttons, the
  ticker + Credit/Bet readouts, and the spin cluster.
- **Portrait:** `"logo logo" / "center center" / "buy ante" / "deck deck"`.
- **No top bar.** The board column starts with the board and the board sits as high as it can;
  in portrait the spare height falls below it.
- Short landscape phones keep the ticker on the same deck row as the readouts.

## Contracts

1. **Zero reflow.** No state change (ticker states, bonus values, round ID) may move or resize
   the board: fixed tracks, single-line clipped text, overlays outside the document flow.
   Enforced by `tools/layout-check.js` at 9 viewports. The same holds for everything outside
   the grid: value elements reserve their box (the ticker line has one fixed height, the
   Credit/Bet strip a fixed width with the Bet value and label reserved, the autoplay count is
   a corner bubble, the big-win stage is sized once per celebration), and animations use
   transform/opacity only. `tools/probes/ui-stability-probe.js` measures it (layout-shift 0 and
   no moved box at 320/360/390/768/1366, every animation actually running).
2. **Board shape** is the engine's 6×5 (`aspect-ratio: 6 / 5`), letterboxed/pillarboxed, never
   stretched.
3. **Touch targets** ≥44px (invisible `::after` hit areas where the visual is smaller).
4. **Controls are vector** (inline SVG + CSS); no image plates.
5. **Ticker** (`#psTicker`) is the only message line; its WIN state is gold, bold, laser-glow
   (`.ps-ticker[data-state="win"]`). Its box never changes size, and neither does its line
   (`#psTickerText`: full width, one fixed line height for every state).

## Source of truth

`client/index.html`, `client/styles.css`, `client/main.js` (`THEME`, `WIN_TIERS`).
