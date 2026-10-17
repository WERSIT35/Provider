#!/usr/bin/env node
"use strict";

/**
 * Relic Forge Monte Carlo (docs/relic-forge/02-tech-plan.md phase 7).
 *
 *   node tools/relicforge-sim.js                     # 10M paid rounds (MODE=base)
 *   MODE=bonus STEPS=1000000 node tools/relicforge-sim.js
 *   MODE=relics STEPS=200000 node tools/relicforge-sim.js   # per-relic EV / variance
 *
 * One base sample = one paid round INCLUDING its whole Forge, played continuously per
 * shard: the Forge meter carries from spin to spin, as for one player at one bet (the
 * RGS keeps it per player and bet). One bonus sample = one Forge from its trigger state.
 * Picks follow POLICY: random (default) | first | worst | force:<RELIC> (that relic when
 * offered, else random). With the strict equal-EV table every policy must give the same
 * RTP (MODE=policies compares them).
 *
 * MODE=calibrate (CALIB=<file.json>): random-pick Forges; every pick's realised rest-of-
 * Forge value against the equal-EV table's prediction, by (relic, spins left). Feeds
 * CALIBRATE= in tools/relicforge-ev.js.
 *
 * Env: STEPS, MODE (base|bonus|relics|policies|calibrate), GAME_ID (relicforge|_94|_92), SEED,
 * SHARDS (fixed 20: machine-independent results), WORKERS, BET (1), POLICY, JSON=1,
 * RULES=<path> (a candidate rules file, for tuning), REPORT=<path.md> (write a report).
 * Randomness: xoshiro128** per shard (as tools/rtp-parity.js), the picks from their own
 * stream so a policy never changes the game's draws.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "games", "relicforge", "game.json");
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const ENGINE_DIR = path.resolve(path.dirname(MANIFEST_PATH), MANIFEST.engine.dir);
const RULES_PATH = process.env.RULES ? path.resolve(process.env.RULES) : path.resolve(path.dirname(MANIFEST_PATH), MANIFEST.rules);

function xoshiro(seedText) {
  const h = crypto.createHash("sha256").update(seedText).digest();
  const s = new Uint32Array([h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)]);
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  return function next() {
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 11);
    return result;
  };
}

function seededCrypto(seedText) {
  const next = xoshiro(seedText);
  return {
    getRandomValues(view) {
      if (view instanceof Uint32Array) {
        for (let i = 0; i < view.length; i += 1) view[i] = next();
      } else {
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        for (let i = 0; i < bytes.length; i += 4) {
          const w = next();
          for (let b = 0; b < 4 && i + b < bytes.length; b += 1) bytes[i + b] = (w >>> (8 * b)) & 0xff;
        }
      }
      return view;
    },
    randomUUID: () => "sim"
  };
}

function loadEngine(seed) {
  const context = vm.createContext({ crypto: seededCrypto(seed), console });
  for (const file of MANIFEST.engine.files) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, file), "utf8");
    new vm.Script(`(function (module, exports) {${src}\n})`, { filename: file }).runInContext(context).call(context, { exports: {} }, {});
  }
  return context.RelicForge;
}

const DIST_EDGES = [0, 0.000001, 1, 2, 5, 10, 20, 50, 100, 500, 1000, 5000, 10000];
const RELICS = ["IGNITE", "CHAIN", "EXPAND", "MAGNET", "HOARD", "SURGE"];

function newAcc() {
  return {
    n: 0, sum: 0, sumSq: 0, baseSum: 0, bonusSum: 0, hits: 0, baseHits: 0, max: 0, capHits: 0, truncated: 0,
    bonuses: 0, byMeter: 0, byScatter: 0, byBoth: 0, bonusSumSq: 0, bonusMax: 0, forgeSpins: 0,
    evolutions: { INFERNO: 0, CATHEDRAL: 0, SINGULARITY: 0 },
    dist: new Array(DIST_EDGES.length).fill(0), distWin: new Array(DIST_EDGES.length).fill(0)
  };
}

/** Pick an index into `offer` by policy, from the policy's own stream. */
function picker(policy, nextPolicy) {
  return function pick(offer) {
    if (policy === "first") return 0;
    if (policy.startsWith("force:")) {
      const i = offer.indexOf(policy.slice(6));
      if (i >= 0) return i;
    }
    if (policy === "worst") return offer.length - 1;
    return nextPolicy() % offer.length;
  };
}

/** Play one Forge to its end from `featureState`; returns its total pay (currency) and stats. */
function playForge(engine, featureState, playerState, bet, pick, acc, cal) {
  let fs = featureState;
  let total = 0;
  let guard = 0;
  let last = null;
  const picks = [];
  while (fs && fs.forge && fs.forge.spins_left > 0 && guard < 100) {
    engine.session.featureState = fs;
    engine.session.playerState = playerState;
    const choice = pick(fs.forge.pending_offer);
    if (cal) picks.push({ forge: fs.forge, relic: fs.forge.pending_offer[choice], from: total });
    const r = engine.spin({ bet_amount: bet, choice, spin_id: "s" });
    total += r.total_win;
    if (r.cap_reached) acc.capHits += 1;
    if (r.cascade_truncated) acc.truncated += 1;
    acc.forgeSpins += 1;
    for (const e of r.evolved) acc.evolutions[e] += 1;
    last = r;
    fs = r.feature_state;
    guard += 1;
  }
  if (cal) {
    // Each pick: the Forge pay from that spin on, in the table's raw units (before the
    // free-spin scaler and the Relic bonus collected before the pick), against V(s).
    for (const p of picks) {
      const s = cal.sig(p.forge.relics, p.forge.evolutions, p.forge.spins_left);
      const predicted = cal.values[s];
      if (predicted === undefined) continue;
      const warm = p.forge.relics.SURGE >= 1 || p.forge.relics.MAGNET >= 1 ? 1 : 0;
      const level = p.forge.relics[p.relic] || 0;
      const g = (cal.groups[`${p.relic}|${p.forge.spins_left}|${warm}|${level}`] ||= { sumR: 0, sumV: 0, count: 0 });
      g.sumR += (total - p.from) / (bet * cal.scaler * p.forge.relic_bonus);
      g.sumV += predicted;
      g.count += 1;
    }
  }
  return { total, last };
}

function record(acc, win, bet) {
  const x = win / bet;
  acc.n += 1;
  acc.sum += x;
  acc.sumSq += x * x;
  if (x > 0) acc.hits += 1;
  if (x > acc.max) acc.max = x;
  let band = 0;
  while (band + 1 < DIST_EDGES.length && x >= DIST_EDGES[band + 1]) band += 1;
  acc.dist[band] += 1;
  acc.distWin[band] += x;
}

function runShard({ seed, samples, gameId, mode, bet, policy, calibrate }) {
  const RF = loadEngine(seed);
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const engine = new RF.SpinEngine({ rules });
  engine.session = { gameId, featureState: null, playerState: null };
  const pick = picker(policy, xoshiro(`${seed}/policy`));
  const acc = newAcc();
  const perRelic = {};
  for (const r of RELICS) perRelic[r] = { n: 0, sum: 0, sumSq: 0 };
  let meter = null;
  const cal = calibrate
    ? { groups: {}, values: (rules.ev_table && rules.ev_table.values) || {}, scaler: engine.getRtpProfile(gameId).free_spin_payout_scaler, sig: (l, e, n) => RF.EvTable.signature(l, e, n) }
    : null;

  if (mode === "base") {
    for (let i = 0; i < samples; i += 1) {
      engine.session.featureState = null;
      engine.session.playerState = meter;
      const first = engine.spin({ bet_amount: bet, spin_id: "s" });
      meter = first.player_state;
      let win = first.total_win;
      acc.baseSum += first.total_win / bet;
      if (first.total_win > 0) acc.baseHits += 1;
      if (first.cap_reached) acc.capHits += 1;
      if (first.cascade_truncated) acc.truncated += 1;
      if (first.forge_trigger) {
        acc.bonuses += 1;
        if (first.forge_trigger === "meter") acc.byMeter += 1;
        else if (first.forge_trigger === "scatter") acc.byScatter += 1;
        else acc.byBoth += 1;
        const f = playForge(engine, first.feature_state, meter, bet, pick, acc);
        win += f.total;
        acc.bonusSum += f.total / bet;
        const bx = (first.total_win + f.total) / bet;
        acc.bonusSumSq += bx * bx;
        if (bx > acc.bonusMax) acc.bonusMax = bx;
      }
      record(acc, win, bet);
    }
  } else {
    // A Forge from its trigger state (a fresh first offer per sample).
    for (let i = 0; i < samples; i += 1) {
      const forge = {
        spins_total: rules.forge.free_spins, spins_left: rules.forge.free_spins, trigger: "sim", round_x: 0,
        relics: RF.Relics.emptyLevels(), evolutions: [], relic_bonus: 1, carried_mult: null, stuck: [],
        pending_offer: RF.Draft.makeOffer(RF.Relics.emptyLevels(), rules.forge.offer_size, RF.RNG)
      };
      const firstOffer = forge.pending_offer.slice();
      const f = playForge(engine, { forge }, null, bet, pick, acc, cal);
      const x = f.total / bet;
      acc.bonuses += 1;
      acc.bonusSum += x;
      acc.bonusSumSq += x * x;
      if (x > acc.bonusMax) acc.bonusMax = x;
      record(acc, f.total, bet);
      if (policy.startsWith("force:") && firstOffer.indexOf(policy.slice(6)) >= 0) {
        const p = perRelic[policy.slice(6)];
        p.n += 1;
        p.sum += x;
        p.sumSq += x * x;
      }
    }
  }
  return { acc, perRelic, groups: cal ? cal.groups : null, engineVersion: RF.ENGINE_VERSION };
}

if (!isMainThread) {
  parentPort.postMessage(runShard(workerData));
  return;
}

function merge(results) {
  const acc = newAcc();
  const perRelic = {};
  for (const r of RELICS) perRelic[r] = { n: 0, sum: 0, sumSq: 0 };
  for (const { acc: a, perRelic: p } of results) {
    for (const k of Object.keys(acc)) {
      if (k === "max" || k === "bonusMax") acc[k] = Math.max(acc[k], a[k]);
      else if (k === "dist" || k === "distWin") a[k].forEach((v, i) => (acc[k][i] += v));
      else if (k === "evolutions") for (const e of Object.keys(acc.evolutions)) acc.evolutions[e] += a.evolutions[e];
      else acc[k] += a[k];
    }
    for (const r of RELICS) for (const k of ["n", "sum", "sumSq"]) perRelic[r][k] += p[r][k];
  }
  const groups = {};
  for (const r of results) {
    for (const [k, g] of Object.entries(r.groups || {})) {
      const t = (groups[k] ||= { sumR: 0, sumV: 0, count: 0 });
      t.sumR += g.sumR;
      t.sumV += g.sumV;
      t.count += g.count;
    }
  }
  return { acc, perRelic, groups };
}

async function runAll(opts) {
  const { steps, shards, workers } = opts;
  const jobs = Array.from({ length: shards }, (_, i) => ({
    seed: `${opts.seed}/${opts.gameId}/${opts.mode}/${opts.policy}/${i}`,
    samples: Math.floor(steps / shards) + (i < steps % shards ? 1 : 0),
    gameId: opts.gameId,
    mode: opts.mode === "relics" || opts.mode === "policies" || opts.mode === "calibrate" ? "bonus" : opts.mode,
    calibrate: opts.mode === "calibrate",
    bet: opts.bet,
    policy: opts.policy
  }));
  const results = new Array(jobs.length);
  let nextJob = 0;
  let engineVersion = "";
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, () =>
      (async () => {
        while (nextJob < jobs.length) {
          const idx = nextJob++;
          const out = await new Promise((resolve, reject) => {
            const w = new Worker(__filename, { workerData: jobs[idx] });
            w.once("message", resolve);
            w.once("error", reject);
          });
          engineVersion = out.engineVersion;
          results[idx] = out;
        }
      })()
    )
  );
  return { ...merge(results), engineVersion };
}

function stats(acc) {
  const mean = acc.sum / acc.n;
  const sd = Math.sqrt(Math.max(0, acc.sumSq / acc.n - mean * mean));
  return { mean, sd, se: sd / Math.sqrt(acc.n) };
}

const pct = (x, d = 3) => `${(x * 100).toFixed(d)}%`;

function baseReport(acc, opts, engineVersion, seconds) {
  const s = stats(acc);
  const bonusMean = acc.bonuses ? acc.bonusSum / acc.bonuses : 0;
  const lines = [
    `# Relic Forge simulation: ${opts.gameId}, ${opts.mode}`,
    "",
    `engine ${engineVersion} · rules ${path.relative(ROOT, RULES_PATH)} · ${acc.n.toLocaleString("en")} paid rounds · seed "${opts.seed}" · ${opts.shards} shards · policy ${opts.policy} · ${seconds}s`,
    "",
    "| Metric | Value | Target |",
    "|---|---|---|",
    `| RTP | ${pct(s.mean)} ± ${pct(s.se)} (1 SE) | ${opts.target}% |`,
    `| Base game RTP | ${pct(acc.baseSum / acc.n)} | ~55% of RTP |`,
    `| Forge RTP | ${pct(acc.bonusSum / acc.n)} | ~45% of RTP |`,
    `| Split base / Forge | ${pct(acc.baseSum / acc.sum, 1)} / ${pct(acc.bonusSum / acc.sum, 1)} | 55 / 45 |`,
    `| Hit frequency (paid rounds with a win) | ${pct(acc.hits / acc.n, 2)} | ~28% |`,
    `| Forge frequency | 1 in ${(acc.n / Math.max(1, acc.bonuses)).toFixed(1)} | ~1 in 180 |`,
    `| … by meter / scatter / both | 1 in ${(acc.n / Math.max(1, acc.byMeter)).toFixed(0)} / 1 in ${(acc.n / Math.max(1, acc.byScatter)).toFixed(0)} / ${acc.byBoth} | |`,
    `| Average Forge (trigger + 10 spins) | ${bonusMean.toFixed(2)}x | ~77.8x at 96% |`,
    `| Volatility index (SD per paid round) | ${s.sd.toFixed(2)} | high |`,
    `| Max win seen | ${acc.max.toFixed(2)}x | cap 10,000x |`,
    `| Max-win cap hits | ${acc.capHits} (1 in ${acc.capHits ? Math.round(acc.n / acc.capHits).toLocaleString("en") : "∞"}) | |`,
    `| Cascades cut at the step bound | ${acc.truncated} | 0 |`,
    `| Evolutions (Inferno / Cathedral / Singularity) | ${acc.evolutions.INFERNO} / ${acc.evolutions.CATHEDRAL} / ${acc.evolutions.SINGULARITY} | |`,
    "",
    "Win distribution (paid round incl. its Forge, in bet multiples):",
    "",
    "| Band | Rounds | Share | RTP |",
    "|---|---|---|---|"
  ];
  for (let i = 0; i < DIST_EDGES.length; i += 1) {
    if (!acc.dist[i]) continue;
    const lo = DIST_EDGES[i];
    const hi = DIST_EDGES[i + 1];
    const label = i === 0 ? "0" : hi === undefined ? `${lo}x+` : `${lo < 1 ? ">0" : lo + "x"} – <${hi}x`;
    lines.push(`| ${label} | ${acc.dist[i].toLocaleString("en")} | ${pct(acc.dist[i] / acc.n, 4)} | ${pct(acc.distWin[i] / acc.n)} |`);
  }
  return lines.join("\n");
}

function bonusReport(acc, opts, engineVersion, seconds) {
  const mean = acc.bonusSum / acc.bonuses;
  const sd = Math.sqrt(Math.max(0, acc.bonusSumSq / acc.bonuses - mean * mean));
  return [
    `# Relic Forge simulation: ${opts.gameId}, Forge only`,
    "",
    `engine ${engineVersion} · ${acc.bonuses.toLocaleString("en")} Forges · seed "${opts.seed}" · policy ${opts.policy} · ${seconds}s`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Average Forge (10 spins, no trigger win) | ${mean.toFixed(3)}x ± ${(sd / Math.sqrt(acc.bonuses)).toFixed(3)} |`,
    `| SD per Forge | ${sd.toFixed(2)}x |`,
    `| Max Forge | ${acc.bonusMax.toFixed(2)}x |`,
    `| Cap hits | ${acc.capHits} |`,
    `| Cascades cut at the step bound | ${acc.truncated} |`,
    `| Evolutions per 1,000 Forges (Inferno / Cathedral / Singularity) | ${["INFERNO", "CATHEDRAL", "SINGULARITY"].map((e) => ((acc.evolutions[e] / acc.bonuses) * 1000).toFixed(2)).join(" / ")} |`
  ].join("\n");
}

async function main() {
  const env = process.env;
  const mode = env.MODE || "base";
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const gameId = env.GAME_ID || rules.rtp_profiles[0].game_id;
  const profile = rules.rtp_profiles.find((p) => p.game_id === gameId) || rules.rtp_profiles[0];
  const opts = {
    mode,
    gameId,
    target: profile.theoretical_percent,
    steps: Number(env.STEPS || (mode === "base" ? 10_000_000 : mode === "bonus" || mode === "calibrate" ? 1_000_000 : 200_000)),
    seed: env.SEED || "relicforge",
    shards: Math.max(1, Number(env.SHARDS || 20)),
    workers: Math.max(1, Number(env.WORKERS || os.cpus().length)),
    bet: Number(env.BET || 1),
    policy: env.POLICY || "random"
  };
  const t0 = Date.now();
  let report;
  let json;
  if (mode === "calibrate") {
    const out = await runAll(opts);
    json = out.groups;
    const worst = Object.entries(out.groups).map(([k, g]) => [k, g.sumR / g.sumV, g.count]).sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1));
    report = ["measured / predicted, worst groups (relic|spins left|warm|level, ratio, picks):", ...worst.slice(0, 12).map((w) => `  ${w[0].padEnd(12)} ${w[1].toFixed(4)}  ${w[2]}`)].join("\n");
    if (env.CALIB) fs.writeFileSync(env.CALIB, JSON.stringify(out.groups));
  } else if (mode === "relics" || mode === "policies") {
    const policies = mode === "relics" ? RELICS.map((r) => `force:${r}`) : ["random", "first", "worst", ...RELICS.map((r) => `force:${r}`)];
    const rows = [];
    for (const policy of policies) {
      const out = await runAll({ ...opts, policy });
      const a = out.acc;
      const mean = a.bonusSum / a.bonuses;
      const sd = Math.sqrt(Math.max(0, a.bonusSumSq / a.bonuses - mean * mean));
      const p = policy.startsWith("force:") ? out.perRelic[policy.slice(6)] : null;
      const pm = p && p.n ? p.sum / p.n : null;
      const psd = p && p.n ? Math.sqrt(Math.max(0, p.sumSq / p.n - pm * pm)) : null;
      rows.push({ policy, mean, sd, se: sd / Math.sqrt(a.bonuses), whenOffered: pm, whenOfferedSd: psd, whenOfferedN: p ? p.n : null });
    }
    json = rows;
    report = [
      `# Relic Forge: ${mode === "relics" ? "per-relic EV and variance" : "RTP by pick policy"} (${opts.gameId})`,
      "",
      `${opts.steps.toLocaleString("en")} Forges per row · seed "${opts.seed}" · ${Math.round((Date.now() - t0) / 1000)}s`,
      "",
      "| Policy | Forge EV (x) | ± 1 SE | SD | EV when first offered (x) | SD | n |",
      "|---|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.policy} | ${r.mean.toFixed(3)} | ${r.se.toFixed(3)} | ${r.sd.toFixed(2)} | ${r.whenOffered === null ? "–" : r.whenOffered.toFixed(3)} | ${r.whenOfferedSd === null ? "–" : r.whenOfferedSd.toFixed(2)} | ${r.whenOfferedN ?? "–"} |`)
    ].join("\n");
  } else {
    const out = await runAll(opts);
    const seconds = Math.round((Date.now() - t0) / 1000);
    report = mode === "base" ? baseReport(out.acc, opts, out.engineVersion, seconds) : bonusReport(out.acc, opts, out.engineVersion, seconds);
    json = { opts, acc: out.acc, engineVersion: out.engineVersion };
  }
  if (env.JSON === "1") console.log(JSON.stringify(json));
  else console.log(report);
  if (env.REPORT) fs.writeFileSync(env.REPORT, report + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
