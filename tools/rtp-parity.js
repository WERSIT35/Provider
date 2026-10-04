#!/usr/bin/env node
"use strict";

/**
 * RTP parity test for the shared client engine (client/engine/*.js).
 *
 * Statistically sound and reproducible:
 *   - One SAMPLE = one paid round played to completion: a paid spin plus every free
 *     spin it triggers (MODE=base), or one Buy Free Spins purchase plus its whole
 *     bonus (MODE=buy). Samples are independent, so the standard error is honest.
 *   - The RNG is seeded. The run is split into a fixed number of SHARDS, each with its
 *     own seed derived from SEED, so the result is identical on every machine
 *     regardless of core count. Shards run in parallel on worker threads.
 *   - PASS requires both (a) |measured − target| ≤ Z·SE and (b) SE ≤ MAX_SE, so a
 *     run cannot pass just by being too small to tell.
 *
 * The seeded generator (xoshiro128**) is a test fixture for reproducibility only;
 * production spins draw from the platform's HMAC-SHA256 seeded stream / CSPRNG.
 *
 * Env:
 *   STEPS      samples (default 10,000,000)       MODE   base | buy (default base)
 *   GAME_ID    RTP profile (default first)        ANTE=1 base mode with ante bet
 *   SEED       master seed (default "vault20k")   BONUS_ONLY=1  alias for MODE=buy
 *   Z          sigma bound (default 3)            MAX_SE max standard error in % (default 0.25)
 *   SHARDS     fixed shard count (default 20)     WORKERS  threads (default = cores)
 *   BET        bet amount (default 1)             JSON=1   print the report as JSON
 *   PAYOUT_SCALER / FREE_SPIN_PAYOUT_SCALER       override the profile (calibration aid)
 * Exits non-zero on FAIL.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const ENGINE_DIR = path.join(ROOT, "client", "engine");
const RULES_PATH = path.join(ROOT, "client", "math", "game-rules-v2.json");

const ENGINE_FILES = [
  "rng.js",
  "config.js",
  "symbols.js",
  "multipliers.js",
  "matrix.js",
  "payouts.js",
  "tumble.js",
  "crazy-mode.js",
  "session-store.js",
  "spin-engine.js",
  "simulator.js"
];

// ── Seeded RNG (xoshiro128**), installed as globalThis.crypto before the engine loads ──
function seededCrypto(seedText) {
  const h = crypto.createHash("sha256").update(seedText).digest();
  const s = new Uint32Array([h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)]);
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  function next() {
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 11);
    return result;
  }
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
    }
  };
}

function runShard({ seed, samples, gameId, mode, ante, bet, scalers }) {
  Object.defineProperty(globalThis, "crypto", { value: seededCrypto(seed), configurable: true, writable: true });
  for (const file of ENGINE_FILES) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, file), "utf8");
    new Function("module", "exports", src).call(globalThis, { exports: {} }, {});
  }
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const engine = new globalThis.SlotEngine.SpinEngine({ rules, storage: null });
  const profile = { ...engine.getRtpProfile(gameId) };
  if (scalers.base !== undefined) profile.payout_scaler = scalers.base;
  if (scalers.fs !== undefined) profile.free_spin_payout_scaler = scalers.fs;
  const anteOn = ante && Boolean(rules.features?.ante_bet?.enabled);
  const session = {
    balance: 1e15, freeSpinsLeft: 0, freeSpinPersistentMultiplier: 0, bonusRoundWin: 0,
    gameId: profile.game_id, rtpProfile: profile, anteEnabled: anteOn, crazyMode: false,
    forceMultiplierValue: null, spinHistory: new Map()
  };
  const opts = { ante_enabled: anteOn, game_id: profile.game_id, rtp_profile: profile };
  const acc = { n: 0, sum: 0, sumSq: 0, baseSum: 0, bonusSum: 0, hits: 0, bonuses: 0, max: 0, capHits: 0 };
  for (let i = 0; i < samples; i += 1) {
    session.balance = 1e15;
    const first = mode === "buy"
      ? engine.evaluateSpinRound(session, bet, { ...opts, ante_enabled: false, force_free_spin_trigger: true, skip_bet_charge: true })
      : engine.evaluateSpinRound(session, bet, opts);
    let win = first.total_win;
    acc.baseSum += first.total_win;
    if (session.freeSpinsLeft > 0) {
      acc.bonuses += 1;
      let guard = 0;
      while (session.freeSpinsLeft > 0 && guard < 10000) {
        const fr = engine.evaluateSpinRound(session, bet, opts);
        win += fr.total_win;
        acc.bonusSum += fr.total_win;
        if ((fr.events || []).some((e) => /MAX_WIN_CAP/.test(e.type))) acc.capHits += 1;
        guard += 1;
      }
    }
    if ((first.events || []).some((e) => /MAX_WIN_CAP/.test(e.type))) acc.capHits += 1;
    acc.n += 1;
    acc.sum += win;
    acc.sumSq += win * win;
    if (win > 0) acc.hits += 1;
    if (win > acc.max) acc.max = win;
  }
  return { acc, profile, anteMultiplier: engine.ANTE_MULTIPLIER, buyCost: engine.BUY_FREE_SPINS_COST_MULT };
}

if (!isMainThread) {
  parentPort.postMessage(runShard(workerData));
  return;
}

const env = process.env;
const rulesForDefaults = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const steps = Number(env.STEPS || 10_000_000);
const mode = env.BONUS_ONLY === "1" ? "buy" : (env.MODE || "base");
const ante = env.ANTE === "1" && mode === "base";
const gameId = env.GAME_ID || rulesForDefaults.rtp_profiles?.[0]?.game_id || "bananax";
const bet = Number(env.BET || 1);
const seed = env.SEED || "vault20k";
const z = Number(env.Z || 3);
const maxSe = Number(env.MAX_SE || 0.25);
const shards = Math.max(1, Number(env.SHARDS || 20));
const workers = Math.max(1, Math.min(shards, Number(env.WORKERS || os.cpus().length)));
const scalers = {
  base: env.PAYOUT_SCALER !== undefined ? Number(env.PAYOUT_SCALER) : undefined,
  fs: env.FREE_SPIN_PAYOUT_SCALER !== undefined ? Number(env.FREE_SPIN_PAYOUT_SCALER) : undefined
};
if (env.TOLERANCE !== undefined) console.warn("TOLERANCE is no longer used; the test now checks |delta| <= Z * SE (see Z, MAX_SE).");
if (!["base", "buy"].includes(mode)) { console.error(`Unknown MODE '${mode}'`); process.exit(2); }

const jobs = Array.from({ length: shards }, (_, i) => ({
  seed: `${seed}/${gameId}/${mode}/${ante ? "ante" : "std"}/${i}`,
  samples: Math.floor(steps / shards) + (i < steps % shards ? 1 : 0),
  gameId, mode, ante, bet, scalers
}));

if (!env.JSON) {
  console.log(`RTP parity: ${steps.toLocaleString()} ${mode === "buy" ? "bonus buys" : "paid rounds"} on '${gameId}'` +
    `${ante ? " (ante)" : ""}, seed '${seed}', ${shards} shards on ${workers} threads`);
}

const t0 = Date.now();
const results = [];
let nextJob = 0;
function launch() {
  if (nextJob >= jobs.length) return null;
  const job = jobs[nextJob++];
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: job });
    w.once("message", (r) => { results.push(r); resolve(); });
    w.once("error", reject);
  }).then(launch);
}

Promise.all(Array.from({ length: workers }, launch)).then(() => {
  const acc = results.reduce((t, { acc: a }) => {
    for (const k of Object.keys(a)) t[k] = k === "max" ? Math.max(t[k] || 0, a[k]) : (t[k] || 0) + a[k];
    return t;
  }, {});
  const { profile, anteMultiplier, buyCost } = results[0];
  const cost = bet * (mode === "buy" ? buyCost : ante ? anteMultiplier : 1);
  const mean = acc.sum / acc.n;
  const sd = Math.sqrt(Math.max(0, acc.sumSq / acc.n - mean * mean));
  const rtp = (mean / cost) * 100;
  const se = (sd / Math.sqrt(acc.n) / cost) * 100;
  const target = Number(mode === "buy" ? profile.buy_free_spins_percent : ante ? profile.ante_bet_percent : profile.theoretical_percent);
  const delta = rtp - target;
  const withinZ = Math.abs(delta) <= z * se;
  const preciseEnough = se <= maxSe;
  const passed = withinZ && preciseEnough;
  const report = {
    game_id: gameId, mode, ante, seed, samples: acc.n, cost_per_sample: cost,
    payout_scaler: profile.payout_scaler, free_spin_payout_scaler: profile.free_spin_payout_scaler,
    target_rtp: target, rtp: +rtp.toFixed(4), se: +se.toFixed(4), delta: +delta.toFixed(4),
    ci95: [+(rtp - 1.96 * se).toFixed(3), +(rtp + 1.96 * se).toFixed(3)],
    first_spin_rtp: +((acc.baseSum / acc.n / cost) * 100).toFixed(4),
    free_spin_rtp: +((acc.bonusSum / acc.n / cost) * 100).toFixed(4),
    hit_rate: +((acc.hits / acc.n) * 100).toFixed(3), bonus_count: acc.bonuses,
    bonus_1_in: acc.bonuses ? +(acc.n / acc.bonuses).toFixed(1) : null,
    avg_bonus_x: acc.bonuses ? +(acc.bonusSum / acc.bonuses / bet).toFixed(3) : null,
    max_win_x: +(acc.max / bet).toFixed(2), cap_hits: acc.capHits,
    elapsed_s: +((Date.now() - t0) / 1000).toFixed(1), passed
  };
  if (env.JSON) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`  target RTP    : ${target.toFixed(2)}%`);
    console.log(`  measured RTP  : ${rtp.toFixed(3)}% ± ${se.toFixed(3)} SE  (95% CI ${report.ci95[0]}–${report.ci95[1]}%)`);
    console.log(`  delta         : ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}% = ${(delta / se).toFixed(2)} SE (limit ±${z} SE)`);
    console.log(`  precision     : SE ${se.toFixed(3)}% (limit ${maxSe}%)${preciseEnough ? "" : "  <- too few samples to judge"}`);
    console.log(`  split         : first spin ${report.first_spin_rtp}% + free spins ${report.free_spin_rtp}%`);
    console.log(`  hit rate      : ${report.hit_rate}%   bonus 1 in ${report.bonus_1_in}   avg bonus ${report.avg_bonus_x}x`);
    console.log(`  max win       : ${report.max_win_x}x   cap hits ${report.cap_hits}`);
    console.log(`  elapsed       : ${report.elapsed_s}s`);
    console.log(`  result        : ${passed ? "PASS" : "FAIL"}`);
  }
  process.exit(passed ? 0 : 1);
}).catch((err) => {
  console.error(err);
  process.exit(2);
});
