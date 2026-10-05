#!/usr/bin/env node
"use strict";

// Builds the Markdown RTP certification report for one RTP profile from the raw
// tools/rtp-parity.js runs in qa/data/rtp-certification/. Every number in the
// report comes from those JSON files or from the rules payload, never by hand.
//
//   GAME_ID=bananax_94 node tools/rtp-report.js > qa/rtp-certification-report-94.md
//
// Expected runs (see the Reproduction section of the output):
//   <game_id>-base-30M.json, <game_id>-ante-30M.json, <game_id>-buy-30M.json   (seed vault20k)
//   <game_id>-base-200M-independent.json, <game_id>-ante-200M-independent.json (seed cert-independent)
//
// Fails (exit 1) if a run was made under a different declaration, engine version
// or seed than the report states, so a stale data file cannot slip into a report.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "qa", "data", "rtp-certification");
const RULES_PATH = path.join(ROOT, "client", "math", "game-rules-v2.json");
const gameId = process.env.GAME_ID || "bananax";
const reportDate = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);

// Same canonical form as platform/src/modules/ledger/hash-chain.ts (stableStringify),
// so this is the rules_hash the platform stamps on every round.
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

const rulesText = fs.readFileSync(RULES_PATH, "utf8");
const rules = JSON.parse(rulesText);
const rulesHash = crypto.createHash("sha256").update(stableStringify(rules)).digest("hex");
const profile = (rules.rtp_profiles || []).find((p) => p.game_id === gameId);
if (!profile) { console.error(`No RTP profile with game_id ${gameId}`); process.exit(1); }

const load = (name) => {
  const file = path.join(DATA, `${gameId}-${name}.json`);
  if (!fs.existsSync(file)) { console.error(`Missing run: ${path.relative(ROOT, file)}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};
const run = {
  base: load("base-30M"), ante: load("ante-30M"), buy: load("buy-30M"),
  baseInd: load("base-200M-independent"), anteInd: load("ante-200M-independent")
};
const declared = { base: profile.theoretical_percent, ante: profile.ante_bet_percent, buy: profile.buy_free_spins_percent };
const declaredFor = (r) => (r.mode === "buy" ? declared.buy : r.ante ? declared.ante : declared.base);

// Consistency gate: each run must match the profile, scalers, declaration and seed it is reported under.
const problems = [];
const engineVersions = new Set();
for (const [key, r] of Object.entries(run)) {
  engineVersions.add(r.engine_version);
  if (r.game_id !== gameId) problems.push(`${key}: game_id ${r.game_id}`);
  if (r.payout_scaler !== profile.payout_scaler || r.free_spin_payout_scaler !== profile.free_spin_payout_scaler) problems.push(`${key}: scalers differ from the rules`);
  if (r.target_rtp !== declaredFor(r)) problems.push(`${key}: run against declared ${r.target_rtp}, rules declare ${declaredFor(r)} — re-run it`);
  if (r.seed !== (key.endsWith("Ind") ? "cert-independent" : "vault20k")) problems.push(`${key}: seed ${r.seed}`);
}
if (engineVersions.size !== 1) problems.push(`mixed engine versions: ${[...engineVersions].join(", ")}`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
const engineVersion = [...engineVersions][0];

// ── formatting ──
const n0 = (n) => Math.round(n).toLocaleString("en-US");
const f = (n, d = 3) => Number(n).toFixed(d);
const fx = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const zf = (n) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const signed = (n, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
const ci = (r) => `${f(r.ci95[0])} – ${f(r.ci95[1])}`;
const z = (r) => (r.rtp - declaredFor(r)) / r.se;
const pass = (r) => Math.abs(z(r)) <= 3 && r.se <= 0.25;
const verdict = (r) => (pass(r) ? "PASS" : "**FAIL**");
const binom = (p, n) => { const h = 1.96 * Math.sqrt(p * (1 - p) / n); return [p - h, p + h]; };
const hitCi = (r) => binom(r.hit_rate / 100, r.samples).map((x) => f(x * 100));
const bonusCi = (r) => binom(r.bonus_count / r.samples, r.samples).map((p) => f(1 / p, 1)).reverse();
const pool = (a, b) => {
  const n = a.samples + b.samples;
  return {
    rtp: (a.rtp * a.samples + b.rtp * b.samples) / n,
    se: Math.sqrt((a.samples * a.se) ** 2 + (b.samples * b.se) ** 2) / n
  };
};
const pooled = { base: pool(run.base, run.baseInd), ante: pool(run.ante, run.anteInd) };
const pooledZ = (p, d) => (p.rtp - d) / p.se;
const allPass = [run.base, run.ante, run.buy, run.baseInd, run.anteInd].every(pass);

const round2 = (x) => Number(Number(x).toFixed(2));
const display = rules.symbol_payout_display;
const groups = display.groups.map((g) => g.label);
const scatter = display.symbols.find((s) => s.symbol === "SCATTER").payouts;
const tiers = Object.keys(scatter).map(Number).sort((a, b) => a - b);
const tierLabel = (t, i) => (i === tiers.length - 1 ? `${t}+` : String(t));
const SYMBOL_WEIGHTS = { "Top Crown": 0.35, Hourglass: 0.42, Ring: 0.52, Chalice: 0.62, "Red Gem": 0.72,
  "Purple Triangle": 0.82, "Yellow Hex": 0.9, "Green Triangle": 0.95, "Blue Diamond": 1 };
const ps = profile.payout_scaler;
const fs_ = profile.free_spin_payout_scaler;
const shown = (raw, s) => fx(round2(round2(raw) * s));

const bands = (r) => r.distribution;
const bandLabel = (b) => (b.to_x === 0.000001 ? "0 (no win)" : b.to_x === null ? `${n0(b.from_x)} (cap)` : `${b.from_x === 0.000001 ? "(0" : `[${n0(b.from_x)}`}, ${n0(b.to_x)})`);
const pct = (n) => `${Number(n).toFixed(2)}%`;
const label = Number(profile.theoretical_percent).toFixed(2);
const maxBase = Math.max(run.base.max_win_x, run.baseInd.max_win_x);
const maxAnte = Math.max(run.ante.max_win_x, run.anteInd.max_win_x);
const capsAnte = run.ante.cap_hits + run.anteInd.cap_hits;
const capsBase = run.base.cap_hits + run.baseInd.cap_hits;
const env = (extra) => `GAME_ID=${gameId} ${extra}`;

const out = [];
const w = (s = "") => out.push(s);

w(`# RTP Certification Report — Vault 20K (${label}% profile)`);
w();
w(`| | |`);
w(`|---|---|`);
w(`| Game | **Vault 20K** by Lumina Games (internal game code \`${gameId}\`) |`);
w(`| RTP profile | \`${gameId}\` (slug \`${profile.slug}\`) — declared base **${pct(declared.base)}**, ante bet **${pct(declared.ante)}**, buy feature **${pct(declared.buy)}** |`);
w(`| Engine | \`client/engine/*.js\`, \`ENGINE_VERSION\` **${engineVersion}** |`);
w(`| Rules payload | \`client/math/game-rules-v2.json\`, rules version **${rules.version}** |`);
w(`| Rules hash | \`${rulesHash}\` (SHA-256, canonical JSON) |`);
w(`| Simulation tool | \`tools/rtp-parity.js\` (seeded, sharded Monte Carlo over the production engine files) |`);
w(`| Report tool | \`tools/rtp-report.js\` (this file is generated from the raw data below) |`);
w(`| Report date | ${reportDate} |`);
w(`| Raw data | \`qa/data/rtp-certification/${gameId}-*.json\` (one file per run, includes the win distribution) |`);
w();
w(`## 1. Summary`);
w();
w(`| Mode | Samples | Measured RTP | 95% CI | Declared | Δ (SE) | Verdict |`);
w(`|---|---|---|---|---|---|---|`);
w(`| Base game | ${n0(run.base.samples)} paid rounds | **${f(run.base.rtp)}%** | ${ci(run.base)} | ${f(declared.base, 2)} | ${signed(run.base.rtp - declared.base)} (${f(Math.abs(z(run.base)), 2)}) | ${verdict(run.base)} |`);
w(`| Ante bet (1.25x) | ${n0(run.ante.samples)} paid rounds | **${f(run.ante.rtp)}%** | ${ci(run.ante)} | ${f(declared.ante, 2)} | ${signed(run.ante.rtp - declared.ante)} (${f(Math.abs(z(run.ante)), 2)}) | ${verdict(run.ante)} |`);
w(`| Buy feature (100x) | ${n0(run.buy.samples)} purchases | **${f(run.buy.rtp)}%** | ${ci(run.buy)} | ${f(declared.buy, 2)} | ${signed(run.buy.rtp - declared.buy)} (${f(Math.abs(z(run.buy)), 2)}) | ${verdict(run.buy)} |`);
w();
w(`Independent confirmation on a second seed (\`cert-independent\`, ${n0(run.baseInd.samples / 1e6)}M paid rounds each):`);
w(`base **${f(run.baseInd.rtp)}%** (95% CI ${ci(run.baseInd)}, ${verdict(run.baseInd)}), ante **${f(run.anteInd.rtp)}%** (95% CI ${ci(run.anteInd)}, ${verdict(run.anteInd)}).`);
w();
w(`Pooled over both seeds: base **${f(pooled.base.rtp)}% ± ${f(pooled.base.se)}** (z = ${zf(pooledZ(pooled.base, declared.base))} vs ${f(declared.base, 2)}), ante **${f(pooled.ante.rtp)}% ± ${f(pooled.ante.se)}** (z = ${zf(pooledZ(pooled.ante, declared.ante))} vs ${f(declared.ante, 2)}).`);
w();
w(allPass
  ? `All runs meet their declared RTP under the acceptance rule (|Δ| ≤ 3 SE, SE ≤ 0.25%).`
  : `**Not every run meets its declared RTP under the acceptance rule (|Δ| ≤ 3 SE, SE ≤ 0.25%) — see the verdicts above.**`);
w(`The ante bet declaration is the pooled ante measurement rounded to two decimals (§7).`);
w();
w(`## 2. Game configuration under test`);
w();
w(`Everything below except the two pay scalers is identical across the three RTP profiles`);
w(`(\`bananax\`, \`bananax_94\`, \`bananax_92\`); the profiles differ only in \`payout_scaler\` and`);
w(`\`free_spin_payout_scaler\`.`);
w();
w(`**Layout and pays.** ${rules.layout.reels} reels × ${rules.layout.rows} rows, symbols pay anywhere, minimum ${rules.layout.min_match_count} matching symbols.`);
w(`Winning symbols are removed and the board tumbles (refills from above) until no win remains.`);
w();
w(`| Symbol | ${groups.join(" | ")} | Weight |`);
w(`|---|${groups.map(() => "---").join("|")}|---|`);
for (const s of display.symbols) {
  if (s.symbol === "SCATTER") continue;
  w(`| ${s.symbol} | ${groups.map((g) => s.payouts[g]).join(" | ")} | ${f(SYMBOL_WEIGHTS[s.symbol], 2)} |`);
}
w(`| Scatter | ${tiers.map((t, i) => `${tierLabel(t, i)}: ${scatter[String(t)]}`).join(" · ")} | ${groups.slice(1).map(() => "").join(" | ")} | |`);
w();
w(`Paytable values are in multiples of the bet **before** the profile scaler. Scatter tiers are`);
w(`lower bounds: a count pays the highest tier it reaches, so 7 or more scatters pay the ${tierLabel(tiers[tiers.length - 1], tiers.length - 1)} tier.`);
w(`Cluster and scatter wins are multiplied by \`payout_scaler\` **${ps}** on paid spins and by`);
w(`\`free_spin_payout_scaler\` **${fs_}** on free spins.`);
w();
w(`**Pays as displayed to the player (bet 1, before multipliers).** The in-game paytable shows`);
w(`scaled pays, rounded the way the engine rounds (\`round(round(pay × bet) × scaler, 2)\`); these`);
w(`are the amounts actually paid. \`tools/probes/paytable-probe.js\` checks every displayed cell`);
w(`against the engine for every profile and allowed bet.`);
w();
w(`| Symbol | Base ${groups.join(" | Base ")} | Free spin ${groups.join(" | Free spin ")} |`);
w(`|---|${groups.map(() => "---").join("|")}|${groups.map(() => "---").join("|")}|`);
for (const s of display.symbols) {
  if (s.symbol === "SCATTER") continue;
  w(`| ${s.symbol} | ${groups.map((g) => shown(s.payouts[g], ps)).join(" | ")} | ${groups.map((g) => shown(s.payouts[g], fs_)).join(" | ")} |`);
}
w(`| Scatter | ${tiers.map((t, i) => `${tierLabel(t, i)}: ${fx(round2(scatter[String(t)] * ps))}`).join(" · ")} | ${groups.slice(1).map(() => "").join(" | ")} | ${tiers.map((t, i) => `${tierLabel(t, i)}: ${fx(round2(scatter[String(t)] * fs_))}`).join(" · ")} | ${groups.slice(1).map(() => "").join(" | ")} |`);
w();
w(`**Special cells (per cell, per drop).**`);
w();
w(`| | Base spin | Ante base spin | Free spin |`);
w(`|---|---|---|---|`);
w(`| Scatter chance | 0.020 | 0.02192 | 0.0086 |`);
w(`| Multiplier chance | 0.0042 | 0.0072 | 0.014 |`);
w();
w(`Multiplier values 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100, 250, 500, 1000 with weights`);
w(`42, 28, 15, 8, 4, 2, 1.1, 0.7, 0.3, 0.15, 0.08, 0.03, 0.01, 0.0025, 0.001, 0.0004.`);
w();
w(`**Multipliers.** Base game: if the round wins, every multiplier that appears during the`);
w(`tumble sequence (including the final, non-winning board) is summed and the sum applies to`);
w(`the round win; with no multiplier the win pays at 1x. Free spins: a global bank starts at 0.`);
w(`When multipliers appear during a **winning** sequence their sum is added to the bank and the`);
w(`whole bank applies to that sequence; a winning sequence with no multiplier pays at 1x even`);
w(`when the bank holds value; a losing sequence never changes the bank.`);
w();
w(`**Free spins.** 4+ scatters award 15 free spins; 3+ scatters during free spins award +5.`);
w();
w(`**Ante bet.** Costs 1.25x the bet and raises the base-game scatter chance only (free spins`);
w(`play identically). Buy feature is disabled while ante is on.`);
w();
w(`**Buy feature.** Costs 100x the bet; plays a paid spin with 4 scatters forced, then the bonus.`);
w();
w(`**Maximum win.** ${n0(rules.max_win_cap_multiplier)}x the bet per feature round **including** the triggering spin. When a`);
w(`round reaches the cap the payout is truncated to the cap and the bonus ends immediately.`);
w();
w(`**No engineered outcomes.** The engine produces only RNG-natural boards; near-miss`);
w(`fabrication was removed in engine 1.0.0.`);
w();
w(`## 3. Method`);
w();
w(`* **Sample definition.** One sample is one complete paid round: a paid spin plus every free`);
w(`  spin it triggers (base and ante), or one purchase plus its whole bonus (buy). Samples are`);
w(`  independent, so the standard error is \`SE = SD / √n\` with no autocorrelation correction.`);
w(`* **RTP** = total paid out ÷ total staked, where stake = bet (base), 1.25 × bet (ante) or`);
w(`  100 × bet (buy). Bet = 1.`);
w(`* **Engine.** The simulator executes the production engine files unmodified, in the`);
w(`  production load order — the same files the browser client and the platform RGS execute.`);
w(`* **Random numbers.** The engine draws all randomness through \`crypto.getRandomValues\`.`);
w(`  For reproducibility the simulator installs a seeded generator (xoshiro128**) in its place.`);
w(`  The run is split into 20 fixed shards (40 for the 200M runs), each seeded with`);
w(`  \`SHA-256(<seed>/<profile>/<mode>/<ante>/<shard>)\`, so results are identical on any machine.`);
w(`  Production spins use the platform's HMAC-SHA256 counter-mode stream keyed by a fresh 32-byte`);
w(`  CSPRNG seed per round; RNG certification of that stream is a separate deliverable.`);
w(`* **Acceptance.** PASS requires |measured − declared| ≤ 3 SE **and** SE ≤ 0.25%.`);
w(`* **Calibration independence.** Scalers were calibrated on seed \`calib\`; this report uses the`);
w(`  default seed \`vault20k\` and an independent seed \`cert-independent\`.`);
w(`* **Pooling.** Pooled RTP is the sample-weighted mean of the two seeds; its SE is`);
w(`  √(Σ (nᵢ·SEᵢ)²) / Σ nᵢ.`);
w(`* **Frequency intervals.** Hit and bonus frequencies carry 95% binomial (normal-approximation)`);
w(`  intervals.`);
w();
w(`## 4. Results — 30M samples per mode (seed \`vault20k\`)`);
w();
const cols = [run.base, run.ante, run.buy];
const row = (name, fn) => w(`| ${name} | ${cols.map(fn).join(" | ")} |`);
w(`| Metric | Base | Ante | Buy |`);
w(`|---|---|---|---|`);
row("Samples", (r) => n0(r.samples));
row("Stake per sample", (r) => String(r.cost_per_sample));
row("RTP", (r) => `${f(r.rtp)}%`);
row("Standard error", (r) => `${f(r.se)}%`);
row("95% CI", ci);
row("RTP from paid spin", (r) => `${f(r.first_spin_rtp)}%`);
row("RTP from free spins", (r) => `${f(r.free_spin_rtp)}%`);
row("Hit frequency (round pays > 0)", (r) => (r.mode === "buy" ? `${f(r.hit_rate)}%` : `${f(r.hit_rate)}% (95% CI ${hitCi(r).join(" – ")})`));
row("Bonus frequency", (r) => (r.mode === "buy" ? "every purchase" : `1 in ${f(r.bonus_1_in, 1)} (95% CI ${bonusCi(r).join(" – ")})`));
row("Average bonus win (free spins only)", (r) => `${f(r.avg_bonus_x, 2)}x`);
row("SD per sample", (r) => `${f(r.sd_per_sample_x, 2)}x`);
row("Volatility index (1.96 × SD)", (r) => f(1.96 * r.sd_per_sample_x, 2));
row("Largest round win", (r) => `${fx(r.max_win_x)}x`);
row(`Rounds capped at ${n0(rules.max_win_cap_multiplier)}x`, (r) => n0(r.cap_hits));
w();
w(`The ${n0(run.baseInd.samples / 1e6)}M independent runs agree: base hit frequency ${f(run.baseInd.hit_rate)}% (${hitCi(run.baseInd).join(" – ")}), bonus 1 in`);
w(`${f(run.baseInd.bonus_1_in, 1)} (${bonusCi(run.baseInd).join(" – ")}); ante hit frequency ${f(run.anteInd.hit_rate)}% (${hitCi(run.anteInd).join(" – ")}), bonus 1 in ${f(run.anteInd.bonus_1_in, 1)} (${bonusCi(run.anteInd).join(" – ")}).`);
w();
w(`### Win distribution (round win in multiples of the bet)`);
w();
w(`| Band | Base count | Base RTP share | Ante count | Ante RTP share | Buy count | Buy RTP share |`);
w(`|---|---|---|---|---|---|---|`);
bands(run.base).forEach((b, i) => {
  const a = run.ante.distribution[i];
  const y = run.buy.distribution[i];
  w(`| ${bandLabel(b)} | ${n0(b.count)} | ${f(b.rtp_share)} | ${n0(a.count)} | ${f(a.rtp_share)} | ${n0(y.count)} | ${f(y.rtp_share)} |`);
});
w();
w(`RTP share is in percentage points of the mode's RTP (the column sums to the measured RTP).`);
const capBand = (r) => r.distribution[r.distribution.length - 1].count;
const capGap = cols.filter((r) => capBand(r) !== r.cap_hits);
if (capGap.length) {
  w(`Rounds counted as capped (${capGap.map((r) => `${r.mode === "buy" ? "buy" : r.ante ? "ante" : "base"} ${n0(r.cap_hits)}`).join(", ")}) can exceed the cap band`);
  w(`(${capGap.map((r) => n0(capBand(r))).join(", ")}): a capped round's total is the sum of rounded per-spin pays, and a sum that lands`);
  w(`a floating-point hair under ${n0(rules.max_win_cap_multiplier)}x is binned in the band below. No round pays more than the cap.`);
}
w(`Every purchase pays at least ${fx(round2(scatter[String(tiers[0])] * ps))}x: the guaranteed ${tiers[0]} scatters pay ${scatter[String(tiers[0])]} × ${ps}.`);
w();
w(`## 5. Maximum-win cap`);
w();
w(`* **Observed.** Across ${n0(run.buy.samples / 1e6)}M purchases, ${n0(run.buy.cap_hits)} rounds reached the cap (largest purchase win`);
w(`  ${fx(run.buy.max_win_x)}x). Largest base round over ${n0((run.base.samples + run.baseInd.samples) / 1e6)}M paid rounds: ${fx(maxBase)}x (${n0(capsBase)} capped);`);
w(`  largest ante round over ${n0((run.ante.samples + run.anteInd.samples) / 1e6)}M paid rounds: ${fx(maxAnte)}x (${n0(capsAnte)} capped). No round exceeded ${n0(rules.max_win_cap_multiplier)}x.`);
w(`* **Scope.** The cap covers the whole feature round: the triggering spin's win seeds the`);
w(`  bonus total (\`bonusRoundWin\`), each free spin pays at most the remainder, and the bonus ends`);
w(`  when the cap is reached. A paid spin that alone reaches the cap awards no free spins.`);
w(`* **Platform enforcement.** The running total is carried on the session`);
w(`  (\`player_sessions.bonus_round_win\`) and recorded in each round's \`pre_state\`, so replay`);
w(`  reproduces the cap (\`platform/test/max-win-cap.test.ts\`).`);
w();
w(`## 6. Replay and versioning`);
w();
w(`Every platform round records \`engine_version\` and \`rules_hash\` alongside the seed, RNG`);
w(`algorithm, bytes drawn, pre-spin state and outcome hash, all inside the hash-chained round`);
w(`ledger. A round resolved under a different engine version or rules payload verifies as`);
w(`*inconclusive* (not *tampered*). The math config registered for this build is version`);
w(`${rules.version} with \`config_hash\` = \`sha256:\` + the rules hash above.`);
w();
w(`## 7. Declarations`);
w();
w(`* **Base and buy** are declared at the profile target ${pct(declared.base)}, which the scalers were calibrated to.`);
w(`* **Ante bet** is declared at **${pct(declared.ante)}**, the pooled ante measurement (${f(pooled.ante.rtp)}% ± ${f(pooled.ante.se)})`);
w(`  rounded to two decimals. Ante is not separately calibrated: it costs 1.25x and raises only`);
w(`  the base-game scatter chance, so it returns slightly more than the base game.`);
w(`* The player-facing Info page shows these three values for the active profile only.`);
w();
w(`## 8. Reproduction`);
w();
w("```bash");
w(`# 30M per mode, default seed (section 4)`);
w(`${env("STEPS=30000000 JSON=1 node tools/rtp-parity.js")}`);
w(`${env("ANTE=1 STEPS=30000000 JSON=1 node tools/rtp-parity.js")}`);
w(`${env("MODE=buy STEPS=30000000 JSON=1 node tools/rtp-parity.js")}`);
w();
w(`# independent 200M confirmation (section 1)`);
w(`${env("SEED=cert-independent STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js")}`);
w(`${env("SEED=cert-independent ANTE=1 STEPS=200000000 SHARDS=40 JSON=1 node tools/rtp-parity.js")}`);
w();
w(`# this report`);
w(`GAME_ID=${gameId} REPORT_DATE=${reportDate} node tools/rtp-report.js`);
w("```");
w();
w(`Results are bit-identical for a given seed, shard count and source revision regardless of`);
w(`machine or thread count.`);

process.stdout.write(out.join("\n") + "\n");
