# Simulation Report v1

## Status

`CURRENT_PROFILE_VALIDATED_FOR_1M_CHECK`

## Simulation Configuration

- Math config ID: `paytable-v1.2.0` + `reel-strips-v1.1.0`
- Validation mode: baseline vs current comparison
- Spins per run: `1,000,000`
- Runs executed: `3`
- Bet normalization: `1.0`
- Date: `2026-04-08`

## 1M Run Results (Current Profile)

- Run 1: RTP `93.95%`, house edge `6.05%`, casino net `+59,928.56`
- Run 2: RTP `93.52%`, house edge `6.48%`, casino net `+64,250.91`
- Run 3: RTP `93.98%`, house edge `6.02%`, casino net `+59,643.05`
- Average RTP: `93.82%`
- Average casino net: `+61,274.17`

## 1M Run Results (Baseline Profile Reference)

- Run 1: RTP `317.61%`, casino net `-1,784,077.52`
- Run 2: RTP `318.61%`, casino net `-1,790,909.74`
- Run 3: RTP `320.66%`, casino net `-1,805,701.01`

## Validation

- RTP target band check (93.50% to 94.50%): `PASS` (all 3 current runs in band)
- Profitability check (`casino_net > 0` for current profile): `PASS` (all 3 runs)
- Big-win suppression vs baseline (`>=20x`, `>=50x`): `PASS` (materially reduced)

## Notes

- Absolute guarantee of zero-loss is not mathematically possible in random systems; release gate enforces positive net on repeated 1M validation runs for the configured profile.
- Next certification step remains `10,000,000+` spins with full variance and tail reporting.
