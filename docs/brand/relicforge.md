# Relic Forge (code `relicforge`)

An alchemist's forge from a lost manuscript: ink, parchment and molten gold.
Engine, rules, ids and payloads are unchanged.

## Palette

| Name | Hex | Use |
|---|---|---|
| Parchment | `#E9DCC0` | page, board |
| Parchment shadow | `#CBB68E` | foxing, sockets |
| Ink | `#1C1611` | lines, text, deck |
| Iron ink | `#3A332C` | frame, secondary text |
| Molten gold | `#FFB000` | heat, wins, Spin, the meter |
| Molten core | `#FF5E1A` | hottest point, Meltdown |
| Verdigris | `#3E8C7A` | runes and specials only |

Molten gold is the only saturated colour, so heat and wins read at a glance.

## Type

- Cinzel Decorative 700: the logo, relic names, banners.
- Cormorant Garamond 600: text.
- IBM Plex Sans Condensed 600: numbers only (tabular).

All three are SIL OFL.

## Board

An open manuscript page in a riveted iron book-clasp frame. Cells are engraved stone sockets. The margins carry engraved marginalia: hammer, tongs, alchemical marks.

## Symbols (ids unchanged, drawn as copperplate engravings)

| Id | Drawn as |
|---|---|
| COPPER, IRON, BRONZE, SILVER | ingots stamped ♀ ♂ ♃ ☽; hatching density shows the metal |
| RUBY, SAPPHIRE, EMERALD, GOLD | cut stones in facet hatching with one colour wash each |
| WILD | crossed hammer and tongs in molten gold |
| EMBER | gold flame in an ink ring |
| SCATTER | engraved anvil on a seal |
| PRISM | prism splitting a gold ray |
| RUNE / BOMB specials | verdigris seals |

## Motion

- Clusters ignite: the lines glow gold, then the cell burns away.
- The Mult is a wax seal that grows at each tier.
- Meltdown: the page tints gold and the margins glow.
- Reduced motion keeps the colours and drops the movement.

## Sound

Anvils, plates, shatter, crunch, sparks, gongs, cannon for big wins, and a furnace drone (see `client/audio/LICENSES.md`).

## Voice

Old-world and terse:
- "The forge is cold."
- "The crucible fills."
- "Choose your relic."
- "Meltdown."
- "Forged: 312.00"
