# Art, not CSS — inventory and plan

Owner's rule (2026-10-27, permanent; CLAUDE.md "Art, not CSS"): everything players see is art
images or SVG. CSS only places things. This file is the inventory of what still breaks the
rule in Vault 20K and the shared Lumina chrome, the order of work, and the art it needs.

How it was measured: every CSS rule in the page's stylesheets with a banned property
(decorative gradient, box-shadow, text-shadow, filter, backdrop-filter, border-image, a
`::before`/`::after` shape), matched against the live Vault page at 390×844 in Chrome
(140 rules: 76 match an element, 61 match none). "Seen" = the element is visible in the base
game; overlays (feature screen, buy confirm, big win, reality check, info) are in the DOM
but hidden until opened.

## Vault 20K's own look (first)

| # | Area | Selectors | What CSS draws | Players see it | Replacement |
|---|---|---|---|---|---|
| V1 | Page | `body`, `body::before` | gradient fallback under the chamber, faint vertical stripes | under/over the chamber art | delete (the chamber art covers it); stripes: delete |
| V2 | Page | `.altar` | gradient + shadow vignette | edges of the screen | delete, or a vignette PNG if the chamber needs it (art needed: none, the chamber art already has its own falloff) |
| V3 | Board backing | `.reels-stage`, `.vault-window` (several media blocks) | dark gradient glass behind the symbols, box-shadows, backdrop blur on phones | always, behind the symbols | **art needed A**: smoked obsidian panel, 9-slice |
| V4 | Board glow | `.vault-aura` | radial gradient + blur glow around the board | always | delete (the frame art carries the edge) |
| V5 | Free-spins light | `.reels-stage::after` (`.is-bonus-lit`) | gradient wash + inset gold box-shadow | during free spins | **art needed D**: warm light on black (additive), stretched over the board |
| V6 | Board frame | `.reels-stage` `border-image` | Frame.webp, 9-slice | always | keep (the allowed 9-slice art frame) |
| V7 | Big-win stage | `.big-win-overlay` bg, `.bw-stage::before`, `.bw-label`, `.bw-amount` | dark gradient scrim, gold ellipse glow, text-shadow, gradient text | every big win | scrim: a flat black at opacity (layout-level fade, allowed); glow: **art needed D**; title and amount: SVG `<text>` with an SVG gold gradient + engraved stroke |
| V8 | Feature screen | `.lsh-panel .lsh-panel__card` (shared structure, Vault's `#featureScreen`) | gradient card + shadow | free-spins intro / outro | **art needed B** (panel 9-slice) + **C** (buttons) |
| V9 | Buy confirm | `.confirm-modal`, `.confirm-dialog`, `.confirm-title`, `.confirm-cost-amount`, `.confirm-btn-*` | blur scrim, gradient panel, text-shadow, gradient text + glow filter, gradient buttons, hover filters | Buy Feature | **B** + **C**; the cost as SVG gold text |
| V10 | Reality check | `.vx-reality__panel`, `.vx-reality__continue` | gradient panel + shadow, gradient button | regulated markets | **B** + **C** |
| V11 | Info | `.ps-modal__panel`, `.round-id-bar` | gradient panel + shadow | the info sheet / round id | **B** |
| V12 | Bonus badge | `.bonus-multi-badge` (+ `::after`, `-value`) | gradient pill, glow ring, text-shadow | free spins with a multiplier | **art needed E**: small gold plate (reuse the multiplier plate art) + SVG number |
| V13 | Canvas | `buildStageCache` cell-corner ticks and dots (main.js) | code-drawn marks between cells | always, faint | delete, or bake into art A |

Not player-facing (dev / admin mode, old screens): `.oracle-band`, `.archive-band`,
`.codex-band`, `.meter-node`, `.header-readout`, `.engine-*`, `#simulateBtn`,
`#simulateBonusBtn`, `.test-multi-btn*`, `.crazy-toggle`, `.progress-bar`, `.ps-icon-btn`,
`button:not(.lsh *)`, `body.perf-low …` and the 61 rules that match nothing. They go in one
cleanup PR (delete what nothing uses; leave admin-mode tools alone).

## Shared Lumina chrome (last; changes every game; needs the owner's approved art)

| # | Area | Selectors | What CSS draws | Replacement |
|---|---|---|---|---|
| S1 | Glass tokens | `:root` (`--lsh-glass*`, reduced-transparency and no-blur fallbacks) | gradient glass fills | **art needed F**: the chrome art set |
| S2 | Deck / rails | `.lsh::before`, `.lsh::after` | glass panels: backdrop blur, gradients, shadows | F: deck plate (9-slice, portrait + landscape) |
| S3 | Buttons | `:where(.lsh, .lsh-sheet, .lsh-panel) button`, `.lsh-btn`, `.lsh-nav > span`, `.lsh-panic span` | glass discs: shadows, text-shadow | F: disc (normal / pressed / disabled); icons stay SVG |
| S4 | Spin | `.lsh-spin` (+ `:disabled` filter) | liquid-gold disc, shadow, grey filter when broke | F: Spin disc + ring (normal / pressed / disabled art, no filter) |
| S5 | Chips | `.lsh-chip`, `.lsh-chip--buy` | glass pill, blur, gold gradient | F: chip plate (glass, gold) |
| S6 | Readouts | `.lsh-read__v` | text-shadow on the numbers | plain text (contrast comes from the deck plate) |
| S7 | Sheets | `.lsh-sheet__panel`, `.lsh-sheet__head` | glass gradient panel, blur | F: sheet panel 9-slice |
| S8 | Big win / splash | `.bw-lasers*`, `.lsh-splash` | CSS laser beams, gradient splash | lasers: dropped for Vault (#153), other games keep them until their art exists; splash: per-game art |

Each game's skin (Moth & Lantern, Relic Forge, Glasshouse, Clockwork) has its own CSS
drawing too; it follows the same rule game by game, after Vault.

## Order of work (small PRs, ≤800 changed lines, one area each)

1. This rule + inventory (docs) — done here.
2. Cleanup: delete the unused and dev-only rules above (no visual change).
3. Vault board: V1, V2, V4, V13 deleted; V3 with art A; V5 with art D.
4. Vault big win: V7 (SVG title and amount, art D glow).
5. Vault dialogs: V8–V11 with art B + C, V12 with E.
6. A lint (`tools/probes/visual-lint.mjs`, in `test:lumina`) that fails on banned properties in
   Vault's files, with an explicit allowlist for anything the owner approves.
7. Shared chrome S1–S8 with art F, after the owner approves it (theme-lint, chrome-identity,
   lumina-parity and lumina-audit updated where they compare what changed).

## Art needed (paste into Gemini; one image each unless it says sheet)

Common style line for every prompt: *premium 3D product render, polished liquid-metal gold,
warm key light from the upper left, hairline teal rim light, high 3/4 camera unless stated,
pure black #000000 background, no text, no letters, no numbers, no watermark.*

**A — board backing (9-slice panel)**
```
A flat rectangular panel of dark smoked obsidian glass seen exactly straight-on, filling the frame edge to edge, very subtle gold dust specks inside the glass, a faint darker vignette toward the corners, no frame, no border, no objects on it. Even and calm in the middle so symbols read clearly on top. Premium 3D product render, warm key light from the upper left. Pure black #000000 outside the panel. No text.
```

**B — dialog panel (9-slice)**
```
A wide rectangular dialog panel seen exactly straight-on: dark bronze-black lacquer face, a thin raised polished-gold bead rim around the edge (small round beads, evenly spaced), a small sculpted golden ram's head at the top centre of the rim, plain empty face for text. The rim's corners and edges are uniform so the panel can be stretched. Premium 3D product render, polished liquid-metal gold, warm key light from the upper left, hairline teal rim light. Pure black #000000 background, no text.
```

**C — button plates (sheet: 2 rows × 3 columns)**
```
Sprite sheet, exact grid 3 columns × 2 rows, equal cells, same centre and same scale in every cell. Row 1: a wide rounded-pill button plate of polished liquid gold with a thin bead edge, in three states: normal, pressed (slightly darker and sunk in), disabled (dull matte gold). Row 2: the same pill shape in dark bronze-black lacquer with a thin gold bead edge, same three states. Seen exactly straight-on, empty faces, no icons. Premium 3D product render, warm key light from the upper left. Pure black #000000 background, no text.
```

**D — warm light (effect, additive)**
```
A soft wide horizontal glow of warm golden light on pure black: an elliptical bloom brightest in the middle, fading smoothly to black at the edges, a few very faint fine golden dust specks. No objects, no hard edges, no rings. Pure black #000000 background, no text.
```

**E — small badge plate**
```
A small horizontal oval plaque of polished liquid gold with a thin bead edge and a tiny sculpted ram's head at the top, empty face for a number. High 3/4 camera, premium 3D product render, warm key light from the upper left, hairline teal rim light. Pure black #000000 background, no text.
```

**F — Lumina chrome set (only after the owner approves the direction; one prompt per piece):**
the deck plate, the button disc (3 states), the Spin disc + ring (3 states), the chip plate,
the sheet panel. Written when step 7 starts, so they match the approved look.
