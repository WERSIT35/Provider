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
   **WIN: amount** (gold) → 30ms vacuum lean → refill drop (15% faster per chained tumble).
5. Repeat step 4 until a step has no win.
6. **Settle**: balance counts up, big-win overlay if ≥10×, the spin lock is released. The WIN
   line holds on the ticker until the next spin.

## Fast-stop / skip

- A press during a round requests fast-stop: airborne reels zip in left to right (≤110ms) and
  lock with a double click; later steps of that round resolve instantly.
- During the big-win overlay a press skips the count-up, the next press dismisses it.

## Timing profile (base, before turbo ×0.4)

| Step | Budget |
|------|--------|
| Reel stagger / symbol stagger | 80ms / 18ms |
| Drop-in fall (heavy reel) | 520ms (tension ×0.9, snap ×0.82; shorter falls scale by √distance) |
| Tumble refill fall | 380ms × 0.85^(step−1), floored at 50% |
| Vacuum lean | 30ms in, 110ms side-lean return |
| Explode | 380ms |
| Win hold | 1100ms first catch, 700ms chained |
| Fast-stop zip | ≤110ms + double click 50ms apart |
| Autoplay gap | 500ms (fixed) |

## Integrity constraint

The client never feeds anything back to the engine. Any change here must keep
`npm run test:client` green and must not touch `client/engine/` (run `npm run test:rtp-parity`
if anything near the engine is touched).
