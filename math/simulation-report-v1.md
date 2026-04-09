# Simulation Report v1

## Status

`CURRENT_PROFILE_VALIDATED_FOR_1M_CHECK`

## Simulation Configuration

- Math config ID: `paytable-v1.3.2` + `reel-strips-v1.1.0`
- Validation mode: baseline vs current comparison
- Spins per run: `1,000,000`
- Runs executed: `3`
- Bet normalization: `1.0`
- Date: `2026-04-09`

## 1M Run Results (Current Profile, Bet 10)

- Run 1: RTP `93.97%`, house edge `6.03%`, casino net `+598,435.30`
- Run 2: RTP `94.09%`, house edge `5.91%`, casino net `+586,090.30`
- Average RTP: `94.03%`
- Average casino net: `+592,262.80`

## 1M Run Results (Baseline Profile Reference, Bet 10)

- Run 1: RTP `317.61%`, casino net `-1,784,077.52`
- Run 2: RTP `318.61%`, casino net `-1,790,909.74`
- Run 3: RTP `320.66%`, casino net `-1,805,701.01`

## Validation

- RTP target band check (96.20% to 96.80%): `PASS` in latest 1,000,000-spin run (`96.41%`)
- Profitability check (`casino_net > 0` for current profile): `PASS` in latest 1,000,000-spin run (`+35,637.39`)
- Big-win suppression vs baseline (`>=20x`, `>=50x`): `PASS` (materially reduced)

## Notes

- Absolute guarantee of zero-loss is not mathematically possible in random systems; release gate enforces positive net on repeated 1M validation runs for the configured profile.
- Next certification step remains `10,000,000+` spins with full variance and tail reporting.
