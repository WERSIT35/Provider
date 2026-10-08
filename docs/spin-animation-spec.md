# Spin Animation Spec — Vault 20K (current)

## Purpose

Define the spin + tumble presentation while preserving server-authoritative outcomes. The motion
language and constants are described in [animation-guide.md](./animation-guide.md).

## Rules

1. The engine resolves every tumble step first; the client only animates what is already resolved.
2. Animation never alters, reorders or hides an outcome; it is presentation only.
3. No winning highlight for the next step while symbols are still falling; a step's winners are
   revealed only after its drop lands.
4. Blast/shatter intensity follows win strength: `blast-small`, `blast-medium`, `blast-great`
   (`WIN_TIERS[].blast`).
5. Multiplier symbols always show their value (`2x`, `25x`, …); a landing multiplier plays its
   BANG once per spin.
6. Scatter landings ping and are counted live on the ticker (`Scatters n/4`).
7. No screen or board shake; no upward wind-up before a drop.

## Round sequence

1. **Press** → the spin lock is taken (one spin per press), the ticker shows the spin line.
2. **Spin-out**: the previous board falls out, bottom-first, at once.
3. **Drop-in**: the new board drops per symbol (reels left → right, bottom-up inside a reel),
   each symbol landing with its own glint + tick; anticipation may hold the last reels.
4. **Win step** (if any): hold + breathe → shatter → win chip flies to the ticker, which cuts to
   **WIN: amount** (gold) → refill drop as soon as the burst's symbols are gone (~115ms after the pop; the
   neighbours never move before it), 15% faster per chained tumble.
5. Repeat step 4 until a step has no win.
6. **Settle**: on a multiplied win (base or bonus, any size) the WIN line first holds the win
   before multiplying; the combine then flies the Win chip up from the WIN line and the Multiplier
   chip down from the Total Multiplier badge, slams them into **Total Win**, and the WIN line counts
   up to the total (a fast-stop skips the combine; turbo scales it). Then the balance counts up,
   big-win overlay if ≥10×, the spin lock is released. The WIN line holds on the ticker until the
   next spin.

## Fast-stop / skip

- A press during the spin slams the board: airborne reels zip in left to right (≤110ms) and lock
  with a double click. A press during tumbles cuts the hold or burst short, but the refill is never
  zipped or pre-placed: it falls under gravity at turbo pace or faster. The Stop is spent once that
  board lands; press again to hurry the next one.
- During the big-win overlay a press skips the count-up, the next press dismisses it.

## Timing profile (base, before turbo ×0.6)

| Step | Budget |
|------|--------|
| Reel release (whole reel at once) | 100ms apart on a spin, 40ms on a tumble refill |
| Spin-out / drop-in / tumble fall (full 5-row fall, one gravity) | 480ms; a fall of d rows takes 480·√(d/5)ms; tumbles × 0.92^(step−1), floored at 60% |
| Landing bounce | restitution 0.18: rises 3.2% of the fall, lasts 0.36 × the fall time |
| Burst lead-in (charge) | 0 / 80 / 150ms (small / medium / great) |
| Explode | 460ms; the symbols' art is gone at 25% of it, and the refill starts then |
| Win hold | 500ms first catch, 400ms chained |
| Fast-stop zip | ≤110ms + double click 50ms apart |
| Autoplay gap | 500ms (fixed) |

## Integrity constraint

The client never feeds anything back to the engine. Any change here must keep
`npm run test:client` green and must not touch `client/engine/` (run `npm run test:rtp-parity`
if anything near the engine is touched).
