# Clockwork Menagerie: RTP simulation report

Rules 1.0.0, engine cw-1.0.0. Seeded Monte Carlo over the real engine file, loaded in a vm context as the RGS loads it (`tools/sim-report.js`, 20 fixed shards, so the result does not depend on the machine).
One sample is one paid round (the spin, its Wound Wild respins and the whole feature it triggers), or one feature buy including its whole feature.

This is a simulation report for internal review. It is not a certificate and makes no claim of approval by any lab or regulator.

## Summary

| Variant | Samples | RTP | 99% CI | SE | Hit rate | Feature 1 in | Max win seen |
|---|---|---|---|---|---|---|---|
| `clockwork` | 100,000,000 | **95.8678%** | 95.1411% – 96.5946% | 0.2822% | 46.37% | 218.4 | 10,000.00× |
| `clockwork_94` | 100,000,000 | **94.3600%** | 93.6395% – 95.0805% | 0.2797% | 48.18% | 223.9 | 10,000.00× |
| `clockwork_92` | 100,000,000 | **92.1461%** | 91.4380% – 92.8543% | 0.2749% | 49.14% | 230.8 | 10,000.00× |
| `clockwork` buy (100×) | 10,000,000 | **95.8223%** | 95.5291% – 96.1155% | 0.1138% | 100% | every buy | 10,000.00× |

The free-spin reels are the same in every variant, so the buy's RTP is the same for all three.

## RTP breakdown (paid rounds)

| Variant | Base game | of which respins | Music box pays | Free spins | Total |
|---|---|---|---|---|---|
| `clockwork` | 48.86% | 17.97% | 1.08% | 47.01% | 95.87% |
| `clockwork_94` | 48.36% | 17.67% | 1.05% | 46.00% | 94.36% |
| `clockwork_92` | 47.88% | 17.37% | 1.02% | 44.27% | 92.15% |

Base game includes the respins and the round that triggers the feature; free spins are the feature's spins only.

## Feature and respin figures

| Variant | Respin round 1 in | Respins per respin round | Feature 1 in | Avg feature (× bet, incl. trigger) | Free spins per feature | Retriggers per feature | Wound reels at the end | Max-win cap hits |
|---|---|---|---|---|---|---|---|---|
| `clockwork` | 25.6 | 2.08 | 218.4 | 106.73 | 8.21 | 0.011 | 0.80 | 8 |
| `clockwork_94` | 25.8 | 2.08 | 223.9 | 107.08 | 8.21 | 0.010 | 0.80 | 9 |
| `clockwork_92` | 26.0 | 2.08 | 230.8 | 106.28 | 8.21 | 0.011 | 0.80 | 18 |
| `clockwork` buy | — | — | — | 95.82 | 8.04 | 0.010 | 0.78 | 11 |

Volatility: standard deviation per paid round `clockwork` 28.22, `clockwork_94` 27.97, `clockwork_92` 27.49 (× bet).

## Win distribution: `clockwork`

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 53.6337% | 0.000% |
| > 0 to < 1 | 36.6698% | 14.098% |
| 1 to < 2 | 5.0051% | 6.220% |
| 2 to < 5 | 2.5939% | 8.432% |
| 5 to < 10 | 1.3570% | 9.281% |
| 10 to < 20 | 0.3808% | 5.091% |
| 20 to < 50 | 0.2310% | 7.263% |
| 50 to < 100 | 0.0572% | 3.829% |
| 100 to < 250 | 0.0297% | 4.726% |
| 250 to < 500 | 0.0194% | 6.981% |
| 500 to < 1000 | 0.0143% | 9.767% |
| 1000 to < 2500 | 0.0049% | 7.569% |
| 2500 to < 5000 | 0.0026% | 9.020% |
| 5000 to < 10000 | 0.0006% | 3.511% |
| 10000 and up (cap 10000) | 0.0000% | 0.080% |

## Win distribution: `clockwork_94`

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 51.8237% | 0.000% |
| > 0 to < 1 | 38.7493% | 14.425% |
| 1 to < 2 | 4.7697% | 5.919% |
| 2 to < 5 | 2.6030% | 8.419% |
| 5 to < 10 | 1.3407% | 9.148% |
| 10 to < 20 | 0.3635% | 4.864% |
| 20 to < 50 | 0.2250% | 7.075% |
| 50 to < 100 | 0.0557% | 3.731% |
| 100 to < 250 | 0.0287% | 4.572% |
| 250 to < 500 | 0.0190% | 6.806% |
| 500 to < 1000 | 0.0141% | 9.658% |
| 1000 to < 2500 | 0.0047% | 7.325% |
| 2500 to < 5000 | 0.0025% | 8.756% |
| 5000 to < 10000 | 0.0006% | 3.582% |
| 10000 and up (cap 10000) | 0.0000% | 0.080% |

## Win distribution: `clockwork_92`

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 50.8593% | 0.000% |
| > 0 to < 1 | 39.8294% | 14.579% |
| 1 to < 2 | 4.7502% | 5.900% |
| 2 to < 5 | 2.5596% | 8.337% |
| 5 to < 10 | 1.3108% | 8.927% |
| 10 to < 20 | 0.3517% | 4.715% |
| 20 to < 50 | 0.2171% | 6.823% |
| 50 to < 100 | 0.0546% | 3.656% |
| 100 to < 250 | 0.0279% | 4.453% |
| 250 to < 500 | 0.0186% | 6.682% |
| 500 to < 1000 | 0.0133% | 9.118% |
| 1000 to < 2500 | 0.0047% | 7.177% |
| 2500 to < 5000 | 0.0023% | 8.118% |
| 5000 to < 10000 | 0.0006% | 3.480% |
| 10000 and up (cap 10000) | 0.0000% | 0.180% |

## Win distribution: `clockwork` buy

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 0.0000% | 0.000% |
| > 0 to < 1 | 0.0000% | 0.000% |
| 1 to < 2 | 0.0000% | 0.000% |
| 2 to < 5 | 33.6023% | 1.220% |
| 5 to < 10 | 16.3291% | 1.092% |
| 10 to < 20 | 9.9524% | 1.452% |
| 20 to < 50 | 17.6518% | 5.839% |
| 50 to < 100 | 8.4061% | 5.726% |
| 100 to < 250 | 5.5354% | 9.022% |
| 250 to < 500 | 4.0971% | 14.695% |
| 500 to < 1000 | 2.9236% | 19.853% |
| 1000 to < 2500 | 0.9096% | 14.384% |
| 2500 to < 5000 | 0.5117% | 17.790% |
| 5000 to < 10000 | 0.0809% | 4.738% |
| 10000 and up (cap 10000) | 0.0001% | 0.011% |

## How to reproduce

```
node games/clockwork/tools/sim-report.js --spins 100000000 --variant clockwork --seed clockwork --json games/clockwork/qa/sim-clockwork-100m.json
node games/clockwork/tools/sim-report.js --spins 100000000 --variant clockwork_94 --seed clockwork --json games/clockwork/qa/sim-clockwork_94-100m.json
node games/clockwork/tools/sim-report.js --spins 100000000 --variant clockwork_92 --seed clockwork --json games/clockwork/qa/sim-clockwork_92-100m.json
node games/clockwork/tools/sim-report.js --spins 10000000 --mode buy --variant clockwork --seed clockwork --json games/clockwork/qa/sim-clockwork-buy-10m.json
node games/clockwork/tools/report-md.js --write-rtp
```
