# Multiplier Rules (Authoritative)

## Base Game

1. Round starts at `1x` effective multiplier.
2. If the round has at least one win and multiplier symbols appear during winning tumble steps, sum all visible multiplier values from those winning steps.
3. Apply base-round multiplier as:

```text
base_round_multiplier = 1 + summed_multiplier_values
```

4. Apply this multiplier only to the current resolved spin+tumble sequence.
5. Next paid spin always starts from `1x` again.

## Free Spins (Bonus)

1. Bonus persistent multiplier starts at `1x` when free spins are awarded.
2. In each bonus round:
- If no win: persistent multiplier does not change.
- If win and no multiplier symbols in winning steps: persistent multiplier does not change.
- If win and multiplier symbols appear in winning steps: add summed symbol values to persistent multiplier.
3. The updated persistent multiplier is applied to that same winning bonus round.
4. Persistent multiplier carries across bonus rounds until free spins end.
5. When free spins end, persistent multiplier resets to `1x`.

## API Fields

Backend response exposes:

- `multipliers_sum_sequence`: sum of qualifying multiplier symbols for the round.
- `multiplier_gain_applied`: gain added this round (`0` if not qualified).
- `multiplier_applied`: multiplier used for round payout.
- `free_spin_multiplier_current`: current persisted bonus multiplier value.

## UI Contract

- HUD must show current active multiplier (`#activeMultiplier`).
- Multiplier symbols on grid must always render explicit labels (`Nx`).
- Caught wins list must show applied round/bonus multiplier context.
