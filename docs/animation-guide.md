# Animation Guide v8

## Motion Language

The animation system now belongs to the sanctum / hanging-sigil client, not the old board model.

1. `pendulumDescent`
- Initial spin entry.
- Sigils swing and descend like suspended objects, not falling tiles.

2. `veilSlip`
- Tumble refill.
- Shorter and cleaner than the main descent.

3. `haloWake`
- Win confirmation after the chamber settles.

4. `relicSnap`
- Win-strength accent.
- Driven by `blast-small`, `blast-medium`, `blast-great`.

5. `ashBloom` + `ashFade`
- Winning sigils collapse and burn away before removal.

6. `omenRing` + `omenLift`
- Scatter-specific motion for ritual symbols.

7. `hushCurtain`
- Board-scoped feature overlay entrance.

## Runtime Rules

- Highlight appears only after the descent completes.
- Descent and tumble use different keyframes.
- Win removal happens before the next tumble render.
- Multiplier badges stay visible on multiplier sigils during all non-removal states.

## Source of Truth

- `client/styles.css`
- `client/main.js`
