# Moth & Lantern (code `classic-5x3`)

A night garden where paper moths drift toward glowing lanterns. Calm, magical, warm.
The game code, variants (`classic-5x3_10`, `_40`), routes, symbol ids and maths stay as they are: only what players see changes.

## Palette

| Name | Hex | Use |
|---|---|---|
| Night indigo | `#141B3A` | sky, page |
| Deep ink | `#0B1026` | shadows, deck |
| Paper cream | `#F3E6C8` | reel strips, labels |
| Lantern amber | `#FFB547` | light, wins, Spin |
| Ember | `#FF7A3D` | lantern core, big wins |
| Moss | `#5E8C61` | foliage, low symbols |
| Moonlight | `#CFE3FF` | moon, free spins night |

## Type

- Fraunces 600 (SIL OFL): the logo, win amounts, celebration titles.
- Nunito 700 (SIL OFL): everything else.
- Scale: 0.72 / 0.86 / 1 / 1.25 / 1.6 / 2.4 rem.

## Board

Five cream paper strips hang on threads from a branch above, against indigo. Cells sit between torn-paper edges, not lines. Foliage silhouettes frame the board. Paper grain comes from a noise texture made once.

## Symbols (ids unchanged)

| Id | Drawn as | Tier |
|---|---|---|
| CHERRY | fern frond | low |
| LEMON | clover | low |
| ORANGE | poppy | low |
| PLUM | iris | low |
| GRAPE | firefly in a jar | mid |
| MELON | paper crane | mid |
| BELL | barn owl | high |
| BAR | luna moth | high |
| SEVEN | golden Moth Queen | top |
| WILD | lit paper lantern; its light falls on neighbouring cells | wild |
| SCATTER | full moon with a cloud strip | scatter |

Low symbols are flat two-tone paper. High and top symbols get layered depth and a thin gold-leaf edge.

## Motion

- Spin: the strips flutter (small sideways sway) and blur.
- Landing: a soft ease-out, never a bounce.
- Win line: a dotted firefly trail.
- Winning cells: an amber glow.
- Free spins: dusk turns to deep night, and five lanterns along the top light one by one.
- Big win: moths spiral up out of the board.
- Reduced motion: no sway, no moths, instant night.

## Sound

Soft and airy:
- paper flutter (swishes);
- glass chimes (`impactGlass_light`);
- glints (`item_gem_*`);
- bells (`bell_02`, `impactBell_heavy`);
- a night bed made from bells pitched down with long echo.

No chips, no coins. Built by `tools/build-game-audio.mjs`; credits in `client/audio/LICENSES.md`.

## Voice

Short, warm, present tense:
- "The garden is quiet."
- "Lanterns lit."
- "The moths gather — 12 free spins."
- "Moonlight win: 48.00"

Rules and pays appear only in the Info dialog, generated from `rules.json`.
