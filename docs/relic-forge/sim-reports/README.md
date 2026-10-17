# Relic Forge: simulation reports (phase 7)

Rules: `games/relicforge/math/rules.json` v0.7.0, engine `rf-0.7.0`, seed `final`, 20 shards.

Reproduce with `node tools/relicforge-sim.js`; see the header of `tools/relicforge-sim.js` for the environment variables.

These figures are internal measurements only: the game is **not lab-certified**.

| Report | What |
|---|---|
| [base-96-10M.md](base-96-10M.md) | 10M paid rounds, 96% profile, each round with its whole Forge, meter carried |
| [base-94-5M.md](base-94-5M.md), [base-92-5M.md](base-92-5M.md) | 5M paid rounds, 94% / 92% profiles |
| [forge-96-1M.md](forge-96-1M.md) | 1M Forges from the trigger state |
| [policies-96-1M.md](policies-96-1M.md) | Forge EV by pick strategy (random, first, worst, always-take-each-relic), 1M Forges each |

## Against the targets

| Target | 96% | 94% | 92% |
|---|---|---|---|
| RTP 96 / 94 / 92 | 96.34% ± 0.32 | 94.15% ± 0.44 | 91.98% ± 0.42 |
| Split ~55 / 45 | 54.8 / 45.2 | 55.0 / 45.0 | 55.2 / 44.8 |
| Hit frequency ~28% | 28.05% | 28.06% | 28.09% |
| Forge ~1 in 180 | 1 in 182 (meter 1/430, scatter 1/317) | 1 in 183 | 1 in 183 |
| Volatility (SD per paid round) | 10.1 | 9.8 | 9.5 |
| Max win seen / cap hits | 2,402x / 0 | 1,659x / 0 | 1,888x / 0 |

The 10M run's RTP standard error (0.32%) is too large for a lab-grade RTP statement. Vault 20K's certification runs used 30M–200M rounds per mode; Relic Forge needs the same before certification.

## Equal-EV drafts

`tools/relicforge-ev.js` builds the factor table in two stages:

1. **Model.** Backward induction over the 2,338 reachable draft states, with per-spin values by Monte Carlo.
2. **Calibration.** Six rounds, at 1–2M Forges each. Each relic's group is corrected against measured play, relative to its layer (spins left × Surge/Magnet owned × the relic's level).

Results at 1M Forges per strategy:

| Strategy | Forge EV vs random |
|---|---|
| First option, worst option | +0.07%, +0.12% |
| Always take Ignite / Chain / Magnet / Hoard / Surge | −0.5% … +0.06% |
| Always take Expand | **+0.96%** (≈ +0.42 percentage points of RTP) |

Before the table existed, the relic paths differed by factors of up to ×4,666. The table brings the strategies to within about 1%, and the volatility choice is real: the Forge's SD runs from 85x (Ignite) to 127x (Chain).

**Not met:** the plan's tolerance of 0.10 points of RTP for any strategy. Closing it needs per-state correction from rollouts, plus runs of several million Forges per strategy (1 SE is about 0.14% of the Forge at 1M).

## Design changes the math forced (flagged for approval)

1. **Line Burst doubles only its own step's pay** (`mult.burst_scope: "step"`; GDD A4 alternative). Doubling the running Mult compounds over long Forge cascades: 10% of Forges hit the 10,000x cap.
2. **Hoard and Cathedral thin the low symbols instead of removing them** (`factors`). Removing whole symbol types is exponential in cluster pays:
   - Hoard Lv3 was worth about 30x a plain spin;
   - Cathedral (4 premiums on 6x8) was worth millions x per spin.
   
   With thinning, Hoard runs 0.84 / 1.40 / 2.15 per spin (Ignite: 0.89 / 1.43 / 2.19), and the capstones are Inferno ~10x and Cathedral ~5.7x per spin. The spec-literal forms (`remove`, `premium_only`) still work, but cannot be balanced.
3. **Relic bonus factors range from 0.75 to about 8.** The GDD wanted factors ≥ 1. Rescaling them all by one constant keeps equal EV, but every Forge has 10 picks, so the displayed bonus would grow about 17x. Under 1, they are shown as they are.
4. **10,000x is reachable in principle but not in practice:** the largest win in 10M rounds is about 2,400x. A higher top end needs a deliberate long-tail feature, which is your call.

## Size

The equal-EV table makes `rules.json` about 1 MB (11,886 factors, 11,886 volatility ratings and 2,338 values). For the client and demo it should move into its own file or a compact encoding.
