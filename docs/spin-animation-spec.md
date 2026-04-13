# Spin Animation Spec (Current)

## Purpose

Define the full spin + tumble presentation while preserving server-authoritative outcomes.

## Rules

1. Backend resolves all tumble steps first.
2. Client can animate only what backend already resolved.
3. During tumble falls, do not show winning borders for the next step.
4. Reveal win highlight only after drop animation finishes.
5. Apply blast intensity tiers by win strength:
- `small` for low-paying symbol groups
- `medium` for mid-paying symbol groups
- `great` for premium symbol groups and/or larger matches
6. Scatter symbols use a dedicated special pulse effect.
7. Multiplier symbols always show an explicit value label (`2x`, `25x`, etc.).

## Tumble Reveal Sequence

1. Show current winning step with blast + optional win border.
2. Vanish winners.
3. Run drop/fall animation with no next-step highlight.
4. After fall completion, reveal next-step winners and blast.
5. Repeat until no more wins.

## Timing Profile (Current)

- Pre-tumble hold: `200ms`
- Win vanish: `90ms`
- Tumble flash: `120ms`
- Tumble drop: `660ms` minimum (or dynamic drop window)
- Post-drop reveal hold: `180ms`
- Win pulse: `1200ms`

## Integrity Constraint

Animation must never alter resolved outcomes; it is presentation only.
