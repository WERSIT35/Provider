# Glasshouse: RTP simulation report

Rules 1.0.0, engine gh-1.0.0. Seeded Monte Carlo over the real engine file, loaded in a vm context as the RGS loads it (`tools/sim-report.js`, 20 fixed shards, so the result does not depend on the machine).
One sample is one paid spin including the whole feature it triggers, or one feature buy including its whole feature.

This is a simulation report for internal review. It is not a certificate and makes no claim of approval by any lab or regulator.

## Summary

| Variant | Samples | RTP | 99% CI | SE | Hit rate | Feature 1 in | Max win seen |
|---|---|---|---|---|---|---|---|
| `glasshouse` | 100,000,000 | **96.2960%** | 95.9395% – 96.6526% | 0.1384% | 34.48% | 204.6 | 4,786.40× |
| `glasshouse_95` | 100,000,000 | **94.7756%** | 94.4259% – 95.1253% | 0.1358% | 34.48% | 211.2 | 5,000.00× |
| `glasshouse_94` | 100,000,000 | **93.9543%** | 93.6084% – 94.3002% | 0.1343% | 36.49% | 218.4 | 4,437.85× |
| `glasshouse` buy (100×) | 10,000,000 | **96.2951%** | 96.1540% – 96.4361% | 0.0548% | 100% | every buy | 5,000.00× |

The free-spin reels are the same in every variant, so the buy's RTP is the same for all three.

## RTP breakdown (paid spins)

| Variant | Base game | of which Sun Lens spins | Glass Rose pays | Free spins | Total |
|---|---|---|---|---|---|
| `glasshouse` | 50.75% | 18.46% | 1.06% | 45.55% | 96.30% |
| `glasshouse_95` | 50.67% | 18.41% | 1.03% | 44.10% | 94.78% |
| `glasshouse_94` | 51.22% | 18.73% | 0.99% | 42.74% | 93.95% |

Base game includes the spin that triggers the feature; free spins are the feature's spins only.

## Feature and beam figures

| Variant | Sun Lens spins | Feature 1 in | Avg feature (× bet, incl. trigger) | Free spins per feature | Retriggers per feature | Lit panes at the end | Cells per beam | Max-win cap hits |
|---|---|---|---|---|---|---|---|---|
| `glasshouse` | 3.05% | 204.6 | 96.19 | 10.18 | 0.037 | 1.87 | 5.27 | 0 |
| `glasshouse_95` | 3.05% | 211.2 | 96.17 | 10.18 | 0.036 | 1.86 | 5.26 | 2 |
| `glasshouse_94` | 3.06% | 218.4 | 96.36 | 10.18 | 0.036 | 1.87 | 5.27 | 0 |
| `glasshouse` buy | 18.31% | — | 96.30 | 10.18 | 0.036 | 1.87 | 5.33 | 34 |

Volatility: standard deviation per paid spin `glasshouse` 13.84, `glasshouse_95` 13.58, `glasshouse_94` 13.43 (× bet).

## Win distribution: `glasshouse`

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 65.5154% | 0.000% |
| > 0 to < 1 | 19.3981% | 11.583% |
| 1 to < 2 | 9.6892% | 13.100% |
| 2 to < 5 | 3.5333% | 10.120% |
| 5 to < 10 | 0.9756% | 6.817% |
| 10 to < 20 | 0.4501% | 6.018% |
| 20 to < 50 | 0.1963% | 6.132% |
| 50 to < 100 | 0.1180% | 8.349% |
| 100 to < 250 | 0.0841% | 12.700% |
| 250 to < 500 | 0.0244% | 8.471% |
| 500 to < 1000 | 0.0125% | 8.461% |
| 1000 to < 2500 | 0.0030% | 4.154% |
| 2500 to < 5000 | 0.0001% | 0.391% |
| 5000 and up (cap 5000) | 0.0000% | 0.000% |

## Win distribution: `glasshouse_95`

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 65.5242% | 0.000% |
| > 0 to < 1 | 19.4376% | 11.647% |
| 1 to < 2 | 9.6729% | 13.101% |
| 2 to < 5 | 3.5115% | 10.052% |
| 5 to < 10 | 0.9816% | 6.872% |
| 10 to < 20 | 0.4477% | 5.987% |
| 20 to < 50 | 0.1889% | 5.907% |
| 50 to < 100 | 0.1144% | 8.094% |
| 100 to < 250 | 0.0824% | 12.444% |
| 250 to < 500 | 0.0238% | 8.249% |
| 500 to < 1000 | 0.0119% | 8.063% |
| 1000 to < 2500 | 0.0029% | 3.979% |
| 2500 to < 5000 | 0.0001% | 0.371% |
| 5000 and up (cap 5000) | 0.0000% | 0.010% |

## Win distribution: `glasshouse_94`

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 63.5058% | 0.000% |
| > 0 to < 1 | 22.5611% | 13.466% |
| 1 to < 2 | 8.7219% | 11.864% |
| 2 to < 5 | 3.3147% | 9.472% |
| 5 to < 10 | 1.0199% | 7.143% |
| 10 to < 20 | 0.4590% | 6.157% |
| 20 to < 50 | 0.1901% | 5.916% |
| 50 to < 100 | 0.1105% | 7.811% |
| 100 to < 250 | 0.0794% | 11.987% |
| 250 to < 500 | 0.0230% | 7.992% |
| 500 to < 1000 | 0.0116% | 7.826% |
| 1000 to < 2500 | 0.0029% | 3.962% |
| 2500 to < 5000 | 0.0001% | 0.359% |
| 5000 and up (cap 5000) | 0.0000% | 0.000% |

## Win distribution: `glasshouse` buy

| Round win (× cost) | Share of samples | RTP from this band |
|---|---|---|
| 0 (no win) | 0.0000% | 0.000% |
| > 0 to < 1 | 0.0000% | 0.000% |
| 1 to < 2 | 0.0000% | 0.000% |
| 2 to < 5 | 9.5156% | 0.358% |
| 5 to < 10 | 13.2901% | 0.931% |
| 10 to < 20 | 8.7465% | 1.257% |
| 20 to < 50 | 19.5805% | 7.007% |
| 50 to < 100 | 23.3879% | 16.614% |
| 100 to < 250 | 17.2831% | 26.122% |
| 250 to < 500 | 5.0044% | 17.377% |
| 500 to < 1000 | 2.5298% | 17.140% |
| 1000 to < 2500 | 0.6337% | 8.625% |
| 2500 to < 5000 | 0.0282% | 0.849% |
| 5000 and up (cap 5000) | 0.0003% | 0.015% |

## How to reproduce

```
node games/glasshouse/tools/sim-report.js --spins 100000000 --variant glasshouse --seed glasshouse --json games/glasshouse/qa/sim-glasshouse-100m.json
node games/glasshouse/tools/sim-report.js --spins 100000000 --variant glasshouse_95 --seed glasshouse --json games/glasshouse/qa/sim-glasshouse_95-100m.json
node games/glasshouse/tools/sim-report.js --spins 100000000 --variant glasshouse_94 --seed glasshouse --json games/glasshouse/qa/sim-glasshouse_94-100m.json
node games/glasshouse/tools/sim-report.js --spins 10000000 --mode buy --variant glasshouse --seed glasshouse --json games/glasshouse/qa/sim-glasshouse-buy-10m.json
node games/glasshouse/tools/report-md.js
```
