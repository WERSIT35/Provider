# RTP Certification Report — Vault 20K (96.38% profile)

| | |
|---|---|
| Game | **Vault 20K** by Lumina Games (internal game code `bananax`) |
| RTP profile | `bananax` — declared base **96.38%**, ante bet **96.70%**, buy feature **96.38%** |
| Engine | `client/engine/*.js`, `ENGINE_VERSION` **1.2.0** |
| Rules payload | `client/math/game-rules-v2.json`, rules version **3.2.0** |
| Rules hash | `148fd6a8a2416ca64900509b6f49ea2b7dc02b89749b766258585eba172a95f6` (SHA-256, canonical JSON) |
| Simulation tool | `tools/rtp-parity.js` (seeded, sharded Monte Carlo over the production engine files) |
| Report date | 2026-10-05 |
| Raw data | `qa/data/rtp-certification/*.json` (one file per run, includes the win distribution) |

## 1. Summary

| Mode | Samples | Measured RTP | 95% CI | Declared | Δ (SE) | Verdict |
|---|---|---|---|---|---|---|
| Base game | 30,000,000 paid rounds | **96.535%** | 96.138 – 96.932 | 96.38 | +0.15 (0.76) | PASS |
| Ante bet (1.25x) | 30,000,000 paid rounds | **96.935%** | 96.541 – 97.329 | 96.70 | +0.24 (1.17) | PASS |
| Buy feature (100x) | 30,000,000 purchases | **96.407%** | 96.357 – 96.457 | 96.38 | +0.03 (1.04) | PASS |

Independent confirmation on a second seed (`cert-independent`, 200M paid rounds each):
base **96.333%** (95% CI 96.179 – 96.487), ante **96.665%** (95% CI 96.518 – 96.813).

Pooled over both seeds: base **96.359% ± 0.073**, ante **96.698% ± 0.070** (z = −0.03 vs the 96.70 declaration).

All three modes meet their declared RTP under the acceptance rule (|Δ| ≤ 3 SE, SE ≤ 0.25%).
The ante bet is declared at 96.70%, its pooled measurement rounded to two decimals (§7, O1).

## 2. Game configuration under test

**Layout and pays.** 6 reels × 5 rows, symbols pay anywhere, minimum 8 matching symbols.
Winning symbols are removed and the board tumbles (refills from above) until no win remains.

| Symbol | 8–9 | 10–11 | 12–30 | Weight |
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
| Scatter | 4: 6 · 5: 10 · **6+: 200** | | | |

Paytable values are in multiples of the bet **before** the profile scaler. Scatter tiers are
lower bounds: a count pays the highest tier it reaches, so 7 or more scatters pay the 6+ tier.
Cluster and scatter wins are multiplied by `payout_scaler` **0.9807** on paid spins and by
`free_spin_payout_scaler` **3.8058** on free spins. The in-game paytable shows these scaled
pays (§7, O2); the per-profile reports for `bananax_94` / `bananax_92` list them in full.

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
* **Frequency intervals.** Hit and bonus frequencies carry 95% binomial (normal-approximation)
  intervals.

## 4. Results — 30M samples per mode (seed `vault20k`)

| Metric | Base | Ante | Buy |
|---|---|---|---|
| Samples | 30,000,000 | 30,000,000 | 30,000,000 |
| Stake per sample | 1 | 1.25 | 100 |
| RTP | 96.535% | 96.935% | 96.407% |
| Standard error | 0.202% | 0.201% | 0.026% |
| 95% CI | 96.138 – 96.932 | 96.541 – 97.329 | 96.357 – 96.457 |
| RTP from paid spin | 60.362% | 57.509% | 6.938% |
| RTP from free spins | 36.173% | 39.426% | 89.469% |
| Hit frequency (round pays > 0) | 24.184% (95% CI 24.169 – 24.199) | 23.722% (23.707 – 23.737) | 100% |
| Bonus frequency | 1 in 247.4 (95% CI 246.0 – 248.8) | 1 in 182.5 (181.7 – 183.4) | every purchase |
| Average bonus win (free spins only) | 89.48x | 89.96x | 89.47x |
| SD per sample | 11.09x | 13.76x | 139.80x |
| Volatility index (1.96 × SD) | 21.73 | 26.98 | 274.01 |
| Largest round win | 10,934.59x | 18,835.83x | **20,000.00x** |
| Rounds capped at 20,000x | 0 | 0 | 52 |

The 200M independent runs agree: base hit frequency 24.192% (24.186 – 24.198), bonus 1 in
249.0 (248.4 – 249.5); ante hit frequency 23.717%, bonus 1 in 182.2 (181.8 – 182.5).

### Win distribution (round win in multiples of the bet)

| Band | Base count | Base RTP share | Ante count | Ante RTP share | Buy count | Buy RTP share |
|---|---|---|---|---|---|---|
| 0 (no win) | 22,744,818 | 0 | 22,883,449 | 0 | 0 | 0 |
| (0, 1) | 3,049,049 | 7.267 | 2,748,821 | 5.277 | 0 | 0 |
| [1, 2) | 1,833,166 | 9.933 | 1,728,654 | 7.526 | 0 | 0 |
| [2, 5) | 1,642,702 | 17.169 | 1,656,616 | 14.083 | 0 | 0 |
| [5, 10) | 425,232 | 9.809 | 532,045 | 9.941 | 1,158,447 | 0.299 |
| [10, 20) | 148,680 | 6.938 | 223,107 | 8.322 | 3,312,404 | 1.710 |
| [20, 50) | 84,141 | 8.592 | 125,741 | 10.291 | 9,598,746 | 10.755 |
| [50, 100) | 35,018 | 8.234 | 49,655 | 9.320 | 7,301,447 | 17.309 |
| [100, 500) | 35,041 | 23.023 | 48,770 | 25.651 | 8,112,450 | 53.162 |
| [500, 1,000) | 1,819 | 3.953 | 2,714 | 4.735 | 448,202 | 9.756 |
| [1,000, 5,000) | 330 | 1.522 | 420 | 1.601 | 67,481 | 3.165 |
| [5,000, 20,000) | 4 | 0.096 | 8 | 0.189 | 771 | 0.217 |
| 20,000 (cap) | 0 | 0 | 0 | 0 | 52 | 0.035 |

RTP share is in percentage points of the mode's RTP (the column sums to the measured RTP).
Every purchase pays at least 5x: the guaranteed 4 scatters pay 6 × 0.9807 = 5.88x.

## 5. Maximum-win cap

* **Observed.** Across 30M purchases, 52 rounds reached the cap and every one paid exactly
  20,000.00x. No round in any run exceeded 20,000x (largest base 16,426.93x over 230M paid
  rounds; ante capped twice in 200M, both at exactly 20,000x).
* **Scope.** The cap covers the whole feature round: the triggering spin's win seeds the
  bonus total (`bonusRoundWin`), each free spin pays at most the remainder, and the bonus ends
  when the cap is reached. A paid spin that alone reaches the cap awards no free spins.
* **Platform enforcement.** The RGS rebuilds the engine from the session on every spin; the
  running total is carried on the session (`player_sessions.bonus_round_win`, migration 0006)
  and recorded in each round's `pre_state` so replay reproduces the cap. Covered by
  `platform/test/max-win-cap.test.ts` (a free spin pays at most the remainder under the cap;
  every round of a feature replays as legitimate).

## 6. Replay and versioning

Every platform round records `engine_version` and `rules_hash` alongside the seed, RNG
algorithm, bytes drawn, pre-spin state and outcome hash, all inside the hash-chained round
ledger. Verification replays the stored seed against the stored pre-state; a round resolved
under a different engine version or rules payload is reported as *inconclusive* (not
*tampered*), and a broken chain is always *tampered*. The math config registered on the
platform for this build is version 3.2.0 with `config_hash` = `sha256:` + the rules hash above.
Rules 3.2.0 changes only player-facing copy, the ante declaration and two unused fields
(`markets`, `apex_wild_enabled`); pays, scalers and rates are unchanged from 3.1.0, and every
30M / 200M run above reproduces bit-identically under it.

## 7. Findings

**Resolved in this build**

* **F1 — Ante RTP.** Ante is declared at 96.59% (player-facing rules page and rules payload)
  rather than tuned down to 96.38%. The ante scatter chance is unchanged.
* **F2 — 7+ scatters paid 0.** Scatter tiers are now lower bounds (7+ pays the 6+ tier) in
  both engine paths. Measured effect, same seeds before vs after: base +0.074, ante +0.114,
  buy +0.036 RTP points. No recalibration was needed; base moved closer to its target
  (pooled 96.285% → 96.359%).
* **F3 — Rules version.** Bumped to 3.1.0; seed scripts register it with the real rules hash.

**Closed for lab submission (rules 3.2.0)**

* **O1 — Ante declaration.** Ante is now declared at **96.70%** (rules payload and the player
  Info page), the pooled measurement 96.698% ± 0.070 rounded to two decimals (z = −0.03).
* **O2 — Paytable shows actual pays.** The player Info page now carries the paytable (it was
  previously only in the admin view, and unscaled). It shows a Base game table (×0.9807) and a
  Free Spins table (×3.8058) at the current bet, rounded exactly as the engine rounds, for the
  session's active profile. `tools/probes/paytable-probe.js` compares all 1,254 displayed
  cells per profile (11 bets × base + free spins) with the engine's own pay for that board,
  for all three profiles; it fails if the scaler is dropped.
* **O3 — Rules copy.** Rewritten for Vault 20K by Lumina Games on the 6 × 5 grid, describing
  the tumble, the multiplier and Free Spins rules as the engine implements them, the 20,000x
  round cap and the special bets. "BANANA X", "5 reels x 4 rows", "Apex Wild" and the market
  list are gone; the unused `markets`, `markets_coming_soon` and `apex_wild_enabled` fields
  were removed from the payload. RTP lines are generated from the active profile only, so a
  94% or 92% session no longer sees another profile's RTP.
* **O4 — Other profiles.** `qa/rtp-certification-report-94.md` and
  `qa/rtp-certification-report-92.md`, generated by `tools/rtp-report.js` from 30M runs per
  mode plus 200M independent base and ante runs; their ante declarations are measured the
  same way.

## 8. Reproduction

```bash
# 30M per mode, default seed (section 4)
STEPS=30000000 JSON=1 node tools/rtp-parity.js
ANTE=1 STEPS=30000000 JSON=1 node tools/rtp-parity.js
MODE=buy STEPS=30000000 JSON=1 node tools/rtp-parity.js

# independent 200M confirmation (section 1)
SEED=cert-independent STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js
SEED=cert-independent ANTE=1 STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js
```

Results are bit-identical for a given seed, shard count and source revision regardless of
machine or thread count. Runtime on a 20-thread machine: ~40 s per 30M paid rounds,
~4.5 min per 200M paid rounds, ~10 min per 30M purchases.
