# Styling Guide — Vault 20K (v9)

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

CSS is the source of truth: `THEME` reads the computed tokens at boot, so canvas and DOM can
never drift apart.

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
   Enforced by `tools/layout-check.js` at 9 viewports.
2. **Board shape** is the engine's 6×5 (`aspect-ratio: 6 / 5`), letterboxed/pillarboxed, never
   stretched.
3. **Touch targets** ≥44px (invisible `::after` hit areas where the visual is smaller).
4. **Controls are vector** (inline SVG + CSS); no image plates.
5. **Ticker** (`#psTicker`) is the only message line; its WIN state is gold, bold, laser-glow
   (`.ps-ticker[data-state="win"]`). Its box never changes size.

## Source of truth

`client/index.html`, `client/styles.css`, `client/main.js` (`THEME`, `WIN_TIERS`).
