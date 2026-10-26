# Vault 20K multiplier: a reveal from inside the vault

Audit item A4 (`00-audit.md` 4.1, 4.2). The old reveal (`STRIKE`: a crackle at the top of
the lane, a vertical bolt, a white-gold flash, a winged sun disc) sat too close to a famous
competitor's signature beat. What stays is the structure and the timing, because both are
ours and both are right:

- **No tell.** A new multiplier falls as an ordinary, cluster-safe stand-in (`pickStandIn`) at
  the normal speed. Nothing slows, glows or rumbles before the board has landed.
- **Then the reveal.** After the board lands (`STRIKE.beatMs`), each new multiplier is revealed
  in landing order (`STRIKE.gapMs` apart), and the stand-in turns into the multiplier at the
  reveal's peak. A Stop fires every pending reveal at once (`strikeQuick`); none is skipped.
- **The board stays still.** No shake, no idle motion, local light only.

What changes is the **source** of the reveal and the **shape** of the multiplier. Nothing
comes from the sky: no storm, no vertical bolt from the top, no figure above the board.

## Storyboard A: the laser cutter (chosen)

The vault's own security laser cuts the plate free. It matches the game's laser grid and the
"LASER BREACH" tier name, and it comes from the side (the frame rail), not from above.

| t (ms, normal speed) | Frame |
|---|---|
| 0 | The board has landed. The stand-in sits in its cell like any symbol. |
| `beatMs` − `flickerMs` | A teal emitter dot lights on the **left frame rail**, level with the cell's row (a short flicker, no sound yet). |
| `beatMs` | The beam fires **horizontally** from the rail to the cell's left edge (one frame: light is instant). A thin teal line, 2 px core, soft glow, clipped to the board. |
| `beatMs` → + `flashPeakMs` | The beam's hot point traces the **hexagon outline** of the plate around the cell, clockwise from the left vertex; the traced edge glows amber behind it; a few pooled sparks fall from the hot point (`ShardEmitter`). The zap plays on the first contact. |
| + `flashPeakMs` | The cut closes. The stand-in's art is replaced by the **gold seal plate** under a short amber edge flash (local, on the cell only); the plate seats with the existing impact squash (≤3.5 %, `MULTI_PUNCH`) and a metal clunk. The beam is gone. |
| + `flashMs` | The cut edge's afterglow has faded. The plate rests, perfectly still. |

Two multipliers in one board: each has its own beam from the rail at its own row, in landing
order. Reduced motion: no flicker, no sparks; the beam and the trace still draw (they are the
cause), at half brightness.

## Storyboard B: the tumbler dial (rejected)

The cell is the face of a combination lock. A bolt on the frame rail slides back, the
stand-in rotates as a dial, clicks a few detents and stops on the value; the shackle drops.

Rejected because a dial **turning through numbers** shows values the round did not award on
the way to the one it did: a staged near-miss. A reveal must not invent tension the result
does not hold. It also needs a second, slower beat (the bolt) before the dial, which would
lengthen every round with a multiplier.

## The multiplier: a gold seal plate (art)

Since the Colchis Treasury art (October 2026, `client/assets/ART.md`) the plate is an image,
not vectors: a **pointy-top hexagonal seal** with a granulated rim, one per tier band:
bronze (common), gold (rare, epic), gold with a ruby at each corner (legendary, mythic).
`drawHexPlate` draws the art contained in the multiplier's box and engraves the value across
the face in the game font (dark ink with a light lower lip on gold, light with a dark outline
on bronze), baked once per value and size (`multiplierSprite`). The laser traces the same
hexagon (`plateGeom`), so the cut closes on the plate's outline.

## Timing and sound

The timing keys stay in the motion table (`client/shell/motion.js`, `STRIKE`): the beat, the
gap, the flicker, the peak and the flash length are unchanged, so round length is unchanged.
The `multiplier_strike` event keeps its name (an id) but its sound becomes a laser zap plus a
metal clunk (the existing CC0 zap and anvil recordings, no thunder layer).

## Review

Recorded with `tools/probes/motion-record.js` (deterministic 60 fps capture). Key frames go
in the PR, which asks for an IP review of the final frames before merge.
