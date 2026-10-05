# RTP Certification Report — Vault 20K (92.38% profile)

| | |
|---|---|
| Game | **Vault 20K** by Lumina Games (internal game code `bananax_92`) |
| RTP profile | `bananax_92` (slug `banana_x92_fantasma`) — declared base **92.38%**, ante bet **92.60%**, buy feature **92.38%** |
| Engine | `client/engine/*.js`, `ENGINE_VERSION` **1.2.0** |
| Rules payload | `client/math/game-rules-v2.json`, rules version **3.2.0** |
| Rules hash | `148fd6a8a2416ca64900509b6f49ea2b7dc02b89749b766258585eba172a95f6` (SHA-256, canonical JSON) |
| Simulation tool | `tools/rtp-parity.js` (seeded, sharded Monte Carlo over the production engine files) |
| Report tool | `tools/rtp-report.js` (this file is generated from the raw data below) |
| Report date | 2026-10-05 |
| Raw data | `qa/data/rtp-certification/bananax_92-*.json` (one file per run, includes the win distribution) |

## 1. Summary

| Mode | Samples | Measured RTP | 95% CI | Declared | Δ (SE) | Verdict |
|---|---|---|---|---|---|---|
| Base game | 30,000,000 paid rounds | **92.313%** | 91.930 – 92.696 | 92.38 | −0.07 (0.34) | PASS |
| Ante bet (1.25x) | 30,000,000 paid rounds | **92.404%** | 92.041 – 92.768 | 92.60 | −0.20 (1.05) | PASS |
| Buy feature (100x) | 30,000,000 purchases | **92.409%** | 92.361 – 92.457 | 92.38 | +0.03 (1.17) | PASS |

Independent confirmation on a second seed (`cert-independent`, 200M paid rounds each):
base **92.422%** (95% CI 92.270 – 92.574, PASS), ante **92.625%** (95% CI 92.481 – 92.770, PASS).

Pooled over both seeds: base **92.408% ± 0.072** (z = 0.39 vs 92.38), ante **92.596% ± 0.069** (z = −0.05 vs 92.60).

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
Cluster and scatter wins are multiplied by `payout_scaler` **0.9399** on paid spins and by
`free_spin_payout_scaler` **3.6478** on free spins.

**Pays as displayed to the player (bet 1, before multipliers).** The in-game paytable shows
scaled pays, rounded the way the engine rounds (`round(round(pay × bet) × scaler, 2)`); these
are the amounts actually paid. `tools/probes/paytable-probe.js` checks every displayed cell
against the engine for every profile and allowed bet.

| Symbol | Base 8-9 | Base 10-11 | Base 12-30 | Free spin 8-9 | Free spin 10-11 | Free spin 12-30 |
|---|---|---|---|---|---|---|
| Top Crown | 18.80 | 46.99 | 93.99 | 72.96 | 182.39 | 364.78 |
| Hourglass | 4.70 | 18.80 | 46.99 | 18.24 | 72.96 | 182.39 |
| Ring | 3.76 | 9.40 | 28.20 | 14.59 | 36.48 | 109.43 |
| Chalice | 2.82 | 3.76 | 22.56 | 10.94 | 14.59 | 87.55 |
| Red Gem | 1.88 | 2.82 | 18.80 | 7.30 | 10.94 | 72.96 |
| Purple Triangle | 1.50 | 2.26 | 15.04 | 5.84 | 8.75 | 58.36 |
| Yellow Hex | 0.94 | 1.88 | 9.40 | 3.65 | 7.30 | 36.48 |
| Green Triangle | 0.75 | 1.69 | 7.52 | 2.92 | 6.57 | 29.18 |
| Blue Diamond | 0.47 | 1.41 | 3.76 | 1.82 | 5.47 | 14.59 |
| Scatter | 4: 5.64 · 5: 9.40 · 6+: 187.98 |  |  | 4: 21.89 · 5: 36.48 · 6+: 729.56 |  |  |

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
| RTP | 92.313% | 92.404% | 92.409% |
| Standard error | 0.196% | 0.186% | 0.025% |
| 95% CI | 91.930 – 92.696 | 92.041 – 92.768 | 92.361 – 92.457 |
| RTP from paid spin | 57.904% | 54.882% | 6.655% |
| RTP from free spins | 34.409% | 37.522% | 85.753% |
| Hit frequency (round pays > 0) | 24.183% (95% CI 24.168 – 24.198) | 23.723% (95% CI 23.708 – 23.738) | 100.000% |
| Bonus frequency | 1 in 248.4 (95% CI 247.0 – 249.8) | 1 in 182.6 (95% CI 181.7 – 183.4) | every purchase |
| Average bonus win (free spins only) | 85.47x | 85.63x | 85.75x |
| SD per sample | 10.71x | 12.71x | 134.19x |
| Volatility index (1.96 × SD) | 20.98 | 24.90 | 263.01 |
| Largest round win | 11,871.82x | 17,726.00x | 20,000.00x |
| Rounds capped at 20,000x | 0 | 0 | 56 |

The 200M independent runs agree: base hit frequency 24.193% (24.187 – 24.199), bonus 1 in
248.9 (248.3 – 249.4); ante hit frequency 23.717% (23.711 – 23.723), bonus 1 in 182.3 (182.0 – 182.7).

### Win distribution (round win in multiples of the bet)

| Band | Base count | Base RTP share | Ante count | Ante RTP share | Buy count | Buy RTP share |
|---|---|---|---|---|---|---|
| 0 (no win) | 22,745,085 | 0.000 | 22,883,202 | 0.000 | 0 | 0.000 |
| (0, 1) | 3,047,926 | 6.975 | 2,748,965 | 5.067 | 0 | 0.000 |
| [1, 2) | 1,935,038 | 10.183 | 1,815,924 | 7.667 | 0 | 0.000 |
| [2, 5) | 1,578,816 | 16.404 | 1,610,619 | 13.559 | 0 | 0.000 |
| [5, 10) | 400,895 | 9.211 | 510,323 | 9.470 | 1,169,358 | 0.290 |
| [10, 20) | 142,276 | 6.641 | 214,065 | 7.978 | 3,597,564 | 1.830 |
| [20, 50) | 80,805 | 8.293 | 119,518 | 9.810 | 9,811,599 | 10.946 |
| [50, 100) | 33,818 | 7.954 | 47,990 | 9.010 | 7,173,868 | 17.011 |
| [100, 500) | 33,365 | 21.628 | 46,703 | 24.377 | 7,784,058 | 50.562 |
| [500, 1,000) | 1,734 | 3.756 | 2,336 | 4.066 | 403,646 | 8.769 |
| [1,000, 5,000) | 237 | 1.156 | 351 | 1.293 | 59,146 | 2.770 |
| [5,000, 20,000) | 5 | 0.112 | 4 | 0.106 | 706 | 0.195 |
| 20,000 (cap) | 0 | 0.000 | 0 | 0.000 | 55 | 0.037 |

RTP share is in percentage points of the mode's RTP (the column sums to the measured RTP).
Rounds counted as capped (buy 56) can exceed the cap band
(55): a capped round's total is the sum of rounded per-spin pays, and a sum that lands
a floating-point hair under 20,000x is binned in the band below. No round pays more than the cap.
Every purchase pays at least 5.64x: the guaranteed 4 scatters pay 6 × 0.9399.

## 5. Maximum-win cap

* **Observed.** Across 30M purchases, 56 rounds reached the cap (largest purchase win
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

* **Base and buy** are declared at the profile target 92.38%, which the scalers were calibrated to.
* **Ante bet** is declared at **92.60%**, the pooled ante measurement (92.596% ± 0.069)
  rounded to two decimals. Ante is not separately calibrated: it costs 1.25x and raises only
  the base-game scatter chance, so it returns slightly more than the base game.
* The player-facing Info page shows these three values for the active profile only.

## 8. Reproduction

```bash
# 30M per mode, default seed (section 4)
GAME_ID=bananax_92 STEPS=30000000 JSON=1 node tools/rtp-parity.js
GAME_ID=bananax_92 ANTE=1 STEPS=30000000 JSON=1 node tools/rtp-parity.js
GAME_ID=bananax_92 MODE=buy STEPS=30000000 JSON=1 node tools/rtp-parity.js

# independent 200M confirmation (section 1)
GAME_ID=bananax_92 SEED=cert-independent STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js
GAME_ID=bananax_92 SEED=cert-independent ANTE=1 STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js

# this report
GAME_ID=bananax_92 REPORT_DATE=2026-10-05 node tools/rtp-report.js
```

Results are bit-identical for a given seed, shard count and source revision regardless of
machine or thread count.
