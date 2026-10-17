# classic-5x3: RTP and volatility report

Seeded Monte Carlo over the real engine file (`engine/engine.js`, loaded in a vm context as the RGS loads it), produced by `tools/sim-report.js` and rendered by `tools/report-md.js`. One sample is one paid spin **including the whole free-spins feature it triggers**. Shards are fixed (20), so the figures don't depend on the machine; rerun with the same seed to reproduce them exactly.

This is an internal measurement. It is not a certification and makes no claim of approval by any lab or regulator.

## Summary

| | Target | Result |
|---|---|---|
| RTP (exact, from strips + paytable) | 96.0% ± 0.1 | **96.0203%** (within target) |
| RTP measured, 100,000,000 paid spins (20 lines) | — | **95.9742%**, 99% CI [95.8434%, 96.1050%], SE 0.0508% (contains the exact RTP) |
| Volatility | medium | SD 5.078× bet per paid spin; volatility index (1.645 × SD) 8.353 |
| Hit frequency (20 lines) | — | 47.34% (1 in 2.11) |
| Max win | 5,000× | cap enforced; largest observed 656.7×; cap reached 0 times |

## Variants (fixed lines)

RTP doesn't depend on the line count (see math-spec.md §2); hit frequency and volatility do.

| Variant | Lines | Paid spins | RTP | 99% CI | Hit frequency | SD (× bet) | Volatility index | Free spins 1 in | Largest win |
|---|---|---|---|---|---|---|---|---|---|
| `classic-5x3` | 20 | 100,000,000 | 95.9742% | [95.8434%, 96.1050%] | 47.34% | 5.078 | 8.353 | 150 | 656.7× |
| `classic-5x3_10` | 10 | 10,000,000 | 96.0482% | [95.6066%, 96.4897%] | 30.38% | 5.421 | 8.917 | 149.8 | 591.8× |
| `classic-5x3_40` | 40 | 10,000,000 | 95.7554% | [95.3558%, 96.1550%] | 57.05% | 4.905 | 8.069 | 150.9 | 531.2× |

## Exact vs measured, by part

| Part | Exact | Measured |
|---|---|---|
| Base game (lines + scatters) | 65.3882% | 65.3757% |
| Free spins | 30.6320% | 30.5985% |
| Feature frequency | 1 in 149.9 | 1 in 150 |
| Spins per feature (incl. retriggers) | 23.41 | 23.41 |
| Average feature win | — | 45.91× bet |

## Win distribution (classic-5x3, per paid spin incl. its feature)

| Win (× bet) | Share of spins | RTP contribution |
|---|---|---|
| 0 (no win) | 52.65605% | 0.0000% |
| >0 – 1 | 24.99997% | 11.4210% |
| 1 – 2 | 11.93137% | 14.9292% |
| 2 – 5 | 8.08449% | 22.3732% |
| 5 – 10 | 1.40712% | 9.2599% |
| 10 – 20 | 0.23630% | 3.1034% |
| 20 – 50 | 0.44061% | 15.1537% |
| 50 – 100 | 0.19791% | 13.2627% |
| 100 – 250 | 0.04484% | 6.0539% |
| 250 – 500 | 0.00133% | 0.4033% |
| 500 – 1000 | 0.00003% | 0.0139% |
| 1000 – 2500 | 0.00000% | 0.0000% |
| 2500 – 5000 | 0.00000% | 0.0000% |
| ≥ 5000 | 0.00000% | 0.0000% |

## Reproduce

```bash
node games/classic-5x3/tools/sim-report.js --spins 100000000 --variant classic-5x3 --seed classic-5x3 --json <out>.json
node games/classic-5x3/tools/sim-report.js --spins 10000000 --variant classic-5x3_10 --seed classic-5x3 --json <out>.json
node games/classic-5x3/tools/sim-report.js --spins 10000000 --variant classic-5x3_40 --seed classic-5x3 --json <out>.json
node games/classic-5x3/tools/exact-rtp.js
```

Run time: classic-5x3 1322s, classic-5x3_10 132s, classic-5x3_40 137s.
