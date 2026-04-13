# Styling Guide v8

## Direction

- The game is no longer presented as a board with surrounding panels.
- The new fantasy is a ritual sanctum with a central sigil vault.
- Symbols are hanging medallions inside six relic chambers, not grid tiles.

## Structural Changes

1. `sanctum`
- Full-page wrapper for the ritual machine.

2. `altar`
- Main machine body.

3. `altar-core`
- Three-part composition:
- `oracle-panel`
- `vault-shell`
- `archive-panel`

4. `vault-window`
- Main playable surface.

5. `relic-column`
- One chamber per reel.

6. `sigil`
- Hanging symbol unit.

7. `sigil-medallion`
- Circular symbol presentation replacing all prior tile/cell surfaces.

## Supporting Areas

- `oracle-panel`: live state, recent spins, session totals.
- `archive-panel`: simulation and output logs.
- `codex-strip`: game information, paytable, win model.

## Source of Truth

- `client/index.html`
- `client/styles.css`
- `client/main.js`
