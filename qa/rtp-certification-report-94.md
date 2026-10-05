# RTP Certification Report — Vault 20K (94.40% profile)

| | |
|---|---|
| Game | **Vault 20K** by Lumina Games (internal game code `bananax_94`) |
| RTP profile | `bananax_94` (slug `banana_x_94_fantasma`) — declared base **94.40%**, ante bet **94.68%**, buy feature **94.40%** |
| Engine | `client/engine/*.js`, `ENGINE_VERSION` **1.2.0** |
| Rules payload | `client/math/game-rules-v2.json`, rules version **3.2.0** |
| Rules hash | `148fd6a8a2416ca64900509b6f49ea2b7dc02b89749b766258585eba172a95f6` (SHA-256, canonical JSON) |
| Simulation tool | `tools/rtp-parity.js` (seeded, sharded Monte Carlo over the production engine files) |
| Report tool | `tools/rtp-report.js` (this file is generated from the raw data below) |
| Report date | 2026-10-05 |
| Raw data | `qa/data/rtp-certification/bananax_94-*.json` (one file per run, includes the win distribution) |

## 1. Summary

| Mode | Samples | Measured RTP | 95% CI | Declared | Δ (SE) | Verdict |
|---|---|---|---|---|---|---|
| Base game | 30,000,000 paid rounds | **94.521%** | 94.124 – 94.918 | 94.40 | +0.12 (0.60) | PASS |
| Ante bet (1.25x) | 30,000,000 paid rounds | **94.800%** | 94.425 – 95.175 | 94.68 | +0.12 (0.63) | PASS |
| Buy feature (100x) | 30,000,000 purchases | **94.438%** | 94.389 – 94.488 | 94.40 | +0.04 (1.53) | PASS |

Independent confirmation on a second seed (`cert-independent`, 200M paid rounds each):
base **94.422%** (95% CI 94.271 – 94.573, PASS), ante **94.666%** (95% CI 94.523 – 94.810, PASS).

Pooled over both seeds: base **94.435% ± 0.072** (z = 0.49 vs 94.40), ante **94.684% ± 0.068** (z = 0.05 vs 94.68).

All runs meet their declared RTP under the acceptance rule (|Δ| ≤ 3 SE, SE ≤ 0.25%).
The ante bet declaration is the pooled ante measurement rounded to two decimals (§7).

## 2. Game configuration under test

Everything below except the two pay scalers is identical across the three RTP profiles
(`bananax`, `bananax_94`, `bananax_92`); the profiles differ only in `payout_scaler` and
`free_spin_payout_scaler`.

**Layout and pays.** 6 reels × 5 rows, symbols pay anywhere, minimum 8 matching symbols.
Winning symbols are removed and the board tumbles (refills from above) until no win remains.

| Symbol | 8-9 | 10-11 | 12-30 | Weight |
|---|---|---|---|---|
| Top Crown | 20 | 50 | 100 | 0.35 |
| Hourglass | 5 | 20 | 50 | 0.42 |
| Ring | 4 | 10 | 30 | 0.52 |
| Chalice | 3 | 4 | 24 | 0.62 |
| Red Gem | 2 | 3 | 20 | 0.72 |
| Purple Triangle | 1.6 | 2.4 | 16 | 0.82 |
| Yellow Hex | 1 | 2 | 10 | 0.90 |
| Green Triangle | 0.8 | 1.8 | 8 | 0.95 |
| Blue Diamond | 0.5 | 1.5 | 4 | 1.00 |
| Scatter | 4: 6 · 5: 10 · 6+: 200 |  |  | |

Paytable values are in multiples of the bet **before** the profile scaler. Scatter tiers are
lower bounds: a count pays the highest tier it reaches, so 7 or more scatters pay the 6+ tier.
Cluster and scatter wins are multiplied by `payout_scaler` **0.9605** on paid spins and by
`free_spin_payout_scaler` **3.7276** on free spins.

**Pays as displayed to the player (bet 1, before multipliers).** The in-game paytable shows
scaled pays, rounded the way the engine rounds (`round(round(pay × bet) × scaler, 2)`); these
are the amounts actually paid. `tools/probes/paytable-probe.js` checks every displayed cell
against the engine for every profile and allowed bet.

| Symbol | Base 8-9 | Base 10-11 | Base 12-30 | Free spin 8-9 | Free spin 10-11 | Free spin 12-30 |
|---|---|---|---|---|---|---|
| Top Crown | 19.21 | 48.02 | 96.05 | 74.55 | 186.38 | 372.76 |
| Hourglass | 4.80 | 19.21 | 48.02 | 18.64 | 74.55 | 186.38 |
| Ring | 3.84 | 9.61 | 28.82 | 14.91 | 37.28 | 111.83 |
| Chalice | 2.88 | 3.84 | 23.05 | 11.18 | 14.91 | 89.46 |
| Red Gem | 1.92 | 2.88 | 19.21 | 7.46 | 11.18 | 74.55 |
| Purple Triangle | 1.54 | 2.31 | 15.37 | 5.96 | 8.95 | 59.64 |
| Yellow Hex | 0.96 | 1.92 | 9.61 | 3.73 | 7.46 | 37.28 |
| Green Triangle | 0.77 | 1.73 | 7.68 | 2.98 | 6.71 | 29.82 |
| Blue Diamond | 0.48 | 1.44 | 3.84 | 1.86 | 5.59 | 14.91 |
| Scatter | 4: 5.76 · 5: 9.61 · 6+: 192.10 |  |  | 4: 22.37 · 5: 37.28 · 6+: 745.52 |  |  |

**Special cells (per cell, per drop).**

| | Base spin | Ante base spin | Free spin |
|---|---|---|---|
| Scatter chance | 0.020 | 0.02192 | 0.0086 |
| Multiplier chance | 0.0042 | 0.0072 | 0.014 |

Multiplier values 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100, 250, 500, 1000 with weights
42, 28, 15, 8, 4, 2, 1.1, 0.7, 0.3, 0.15, 0.08, 0.03, 0.01, 0.0025, 0.001, 0.0004.

**Multipliers.** Base game: if the round wins, every multiplier that appears during the
tumble sequence (including the final, non-winning board) is summed and the sum applies to
the round win; with no multiplier the win pays at 1x. Free spins: a global bank starts at 0.
When multipliers appear during a **winning** sequence their sum is added to the bank and the
whole bank applies to that sequence; a winning sequence with no multiplier pays at 1x even
when the bank holds value; a losing sequence never changes the bank.

**Free spins.** 4+ scatters award 15 free spins; 3+ scatters during free spins award +5.

**Ante bet.** Costs 1.25x the bet and raises the base-game scatter chance only (free spins
play identically). Buy feature is disabled while ante is on.

**Buy feature.** Costs 100x the bet; plays a paid spin with 4 scatters forced, then the bonus.

**Maximum win.** 20,000x the bet per feature round **including** the triggering spin. When a
round reaches the cap the payout is truncated to the cap and the bonus ends immediately.

**No engineered outcomes.** The engine produces only RNG-natural boards; near-miss
fabrication was removed in engine 1.0.0.

## 3. Method

* **Sample definition.** One sample is one complete paid round: a paid spin plus every free
  spin it triggers (base and ante), or one purchase plus its whole bonus (buy). Samples are
  independent, so the standard error is `SE = SD / √n` with no autocorrelation correction.
* **RTP** = total paid out ÷ total staked, where stake = bet (base), 1.25 × bet (ante) or
  100 × bet (buy). Bet = 1.
* **Engine.** The simulator executes the production engine files unmodified, in the
  production load order — the same files the browser client and the platform RGS execute.
* **Random numbers.** The engine draws all randomness through `crypto.getRandomValues`.
  For reproducibility the simulator installs a seeded generator (xoshiro128**) in its place.
  The run is split into 20 fixed shards (40 for the 200M runs), each seeded with
  `SHA-256(<seed>/<profile>/<mode>/<ante>/<shard>)`, so results are identical on any machine.
  Production spins use the platform's HMAC-SHA256 counter-mode stream keyed by a fresh 32-byte
  CSPRNG seed per round; RNG certification of that stream is a separate deliverable.
* **Acceptance.** PASS requires |measured − declared| ≤ 3 SE **and** SE ≤ 0.25%.
* **Calibration independence.** Scalers were calibrated on seed `calib`; this report uses the
  default seed `vault20k` and an independent seed `cert-independent`.
* **Pooling.** Pooled RTP is the sample-weighted mean of the two seeds; its SE is
  √(Σ (nᵢ·SEᵢ)²) / Σ nᵢ.
* **Frequency intervals.** Hit and bonus frequencies carry 95% binomial (normal-approximation)
  intervals.

## 4. Results — 30M samples per mode (seed `vault20k`)

| Metric | Base | Ante | Buy |
|---|---|---|---|
| Samples | 30,000,000 | 30,000,000 | 30,000,000 |
| Stake per sample | 1 | 1.25 | 100 |
| RTP | 94.521% | 94.800% | 94.438% |
| Standard error | 0.203% | 0.191% | 0.025% |
| 95% CI | 94.124 – 94.918 | 94.425 – 95.175 | 94.389 – 94.488 |
| RTP from paid spin | 59.273% | 56.121% | 6.794% |
| RTP from free spins | 35.248% | 38.679% | 87.644% |
| Hit frequency (round pays > 0) | 24.203% (95% CI 24.188 – 24.218) | 23.701% (95% CI 23.686 – 23.716) | 100.000% |
| Bonus frequency | 1 in 247.9 (95% CI 246.5 – 249.3) | 1 in 182.5 (95% CI 181.7 – 183.4) | every purchase |
| Average bonus win (free spins only) | 87.39x | 88.25x | 87.64x |
| SD per sample | 11.10x | 13.10x | 137.44x |
| Volatility index (1.96 × SD) | 21.76 | 25.68 | 269.37 |
| Largest round win | 20,000.00x | 17,440.64x | 20,000.00x |
| Rounds capped at 20,000x | 1 | 0 | 63 |

The 200M independent runs agree: base hit frequency 24.196% (24.190 – 24.202), bonus 1 in
249.2 (248.7 – 249.8); ante hit frequency 23.718% (23.712 – 23.724), bonus 1 in 182.6 (182.2 – 182.9).

### Win distribution (round win in multiples of the bet)

| Band | Base count | Base RTP share | Ante count | Ante RTP share | Buy count | Buy RTP share |
|---|---|---|---|---|---|---|
| 0 (no win) | 22,739,051 | 0.000 | 22,889,611 | 0.000 | 0 | 0.000 |
| (0, 1) | 3,050,442 | 7.141 | 2,748,763 | 5.181 | 0 | 0.000 |
| [1, 2) | 1,837,610 | 9.763 | 1,725,323 | 7.365 | 0 | 0.000 |
| [2, 5) | 1,654,384 | 17.024 | 1,665,916 | 13.931 | 0 | 0.000 |
| [5, 10) | 414,659 | 9.466 | 523,043 | 9.648 | 1,164,988 | 0.295 |
| [10, 20) | 150,380 | 6.965 | 224,511 | 8.297 | 3,470,924 | 1.783 |
| [20, 50) | 82,574 | 8.448 | 123,057 | 10.069 | 9,676,495 | 10.826 |
| [50, 100) | 34,470 | 8.098 | 48,857 | 9.162 | 7,236,203 | 17.141 |
| [100, 500) | 34,378 | 22.444 | 47,983 | 25.115 | 7,961,786 | 51.938 |
| [500, 1,000) | 1,797 | 3.914 | 2,530 | 4.415 | 425,811 | 9.264 |
| [1,000, 5,000) | 252 | 1.149 | 402 | 1.516 | 63,019 | 2.949 |
| [5,000, 20,000) | 2 | 0.042 | 4 | 0.101 | 712 | 0.203 |
| 20,000 (cap) | 1 | 0.067 | 0 | 0.000 | 62 | 0.041 |

RTP share is in percentage points of the mode's RTP (the column sums to the measured RTP).
Rounds counted as capped (buy 63) can exceed the cap band
(62): a capped round's total is the sum of rounded per-spin pays, and a sum that lands
a floating-point hair under 20,000x is binned in the band below. No round pays more than the cap.
Every purchase pays at least 5.76x: the guaranteed 4 scatters pay 6 × 0.9605.

## 5. Maximum-win cap

* **Observed.** Across 30M purchases, 63 rounds reached the cap (largest purchase win
  20,000.00x). Largest base round over 230M paid rounds: 20,000.00x (1 capped);
  largest ante round over 230M paid rounds: 20,000.00x (1 capped). No round exceeded 20,000x.
* **Scope.** The cap covers the whole feature round: the triggering spin's win seeds the
  bonus total (`bonusRoundWin`), each free spin pays at most the remainder, and the bonus ends
  when the cap is reached. A paid spin that alone reaches the cap awards no free spins.
* **Platform enforcement.** The running total is carried on the session
  (`player_sessions.bonus_round_win`) and recorded in each round's `pre_state`, so replay
  reproduces the cap (`platform/test/max-win-cap.test.ts`).

## 6. Replay and versioning

Every platform round records `engine_version` and `rules_hash` alongside the seed, RNG
algorithm, bytes drawn, pre-spin state and outcome hash, all inside the hash-chained round
ledger. A round resolved under a different engine version or rules payload verifies as
*inconclusive* (not *tampered*). The math config registered for this build is version
3.2.0 with `config_hash` = `sha256:` + the rules hash above.

## 7. Declarations

* **Base and buy** are declared at the profile target 94.40%, which the scalers were calibrated to.
* **Ante bet** is declared at **94.68%**, the pooled ante measurement (94.684% ± 0.068)
  rounded to two decimals. Ante is not separately calibrated: it costs 1.25x and raises only
  the base-game scatter chance, so it returns slightly more than the base game.
* The player-facing Info page shows these three values for the active profile only.

## 8. Reproduction

```bash
# 30M per mode, default seed (section 4)
GAME_ID=bananax_94 STEPS=30000000 JSON=1 node tools/rtp-parity.js
GAME_ID=bananax_94 ANTE=1 STEPS=30000000 JSON=1 node tools/rtp-parity.js
GAME_ID=bananax_94 MODE=buy STEPS=30000000 JSON=1 node tools/rtp-parity.js

# independent 200M confirmation (section 1)
GAME_ID=bananax_94 SEED=cert-independent STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js
GAME_ID=bananax_94 SEED=cert-independent ANTE=1 STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js

# this report
GAME_ID=bananax_94 REPORT_DATE=2026-10-05 node tools/rtp-report.js
```

Results are bit-identical for a given seed, shard count and source revision regardless of
machine or thread count.
