# Spin Animation Spec (MVP)

## Purpose

Define how spin motion is shown while preserving server-authoritative outcomes.

## Rules

1. Backend resolves outcome first.
2. Client animates reel motion using temporary symbols.
3. Reels stop left-to-right.
4. Each reel reveals final backend symbols at stop.
5. After all reels stop, winning lines are highlighted.
6. If there is any line win, play a short win pulse.

## Timing Profile (Current)

- Spin pre-roll: ~120 ms
- Reel tick interval: ~55 ms
- Reel tick count: increases by reel index (left to right)
- Reel settle delay: ~90 ms between reel stops

## Integrity Constraint

Animation must never alter resolved outcomes; it is presentation only.
