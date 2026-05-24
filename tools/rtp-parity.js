#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENGINE_DIR = path.join(ROOT, "client", "engine");
const RULES_PATH = path.join(ROOT, "client", "math", "game-rules-v2.json");

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
  try {
    globalThis.crypto = require("crypto").webcrypto;
  } catch (err) {
    console.error("Node 18+ required (globalThis.crypto.getRandomValues missing).");
    process.exit(2);
  }
}

const ENGINE_FILES = [
  "rng.js",
  "config.js",
  "symbols.js",
  "multipliers.js",
  "matrix.js",
  "payouts.js",
  "tumble.js",
  "near-miss.js",
  "crazy-mode.js",
  "session-store.js",
  "spin-engine.js",
  "simulator.js"
];

for (const file of ENGINE_FILES) {
  const src = fs.readFileSync(path.join(ENGINE_DIR, file), "utf8");
  const wrap = new Function("module", "exports", src);
  wrap.call(globalThis, { exports: {} }, {});
}

const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const SlotEngine = globalThis.SlotEngine;
if (!SlotEngine || !SlotEngine.SpinEngine) {
  console.error("Engine namespace did not load.");
  process.exit(3);
}

const steps = Number(process.env.STEPS || 1_000_000);
const betAmount = Number(process.env.BET || 1);
const gameId = process.env.GAME_ID || rules.rtp_profiles?.[0]?.game_id || "bananax";
const anteEnabled = process.env.ANTE === "1";
const bonusOnly = process.env.BONUS_ONLY === "1";
const tolerancePct = Number(process.env.TOLERANCE || 0.20);

console.log(`RTP parity test: ${steps.toLocaleString()} spins on '${gameId}' (bet ${betAmount}, ante=${anteEnabled})`);

const engine = new SlotEngine.SpinEngine({ rules, storage: null });
engine.session = {
  sessionId: "parity",
  gameId,
  rtpProfile: engine.getRtpProfile(gameId),
  balance: 0,
  freeSpinsLeft: 0,
  freeSpinPersistentMultiplier: 1,
  forceMultiplierValue: null,
  anteEnabled,
  crazyMode: false,
  spinHistory: new Map(),
  createdAt: new Date().toISOString()
};

const t0 = Date.now();
const report = SlotEngine.Simulator.simulate(engine, {
  steps,
  betAmount,
  anteEnabled,
  bonusOnly,
  gameId
});
const elapsedMs = Date.now() - t0;

const profile = engine.getRtpProfile(gameId);
const target = Number(profile.theoretical_percent || 0);
const actual = Number(report.current.rtp_percent || 0);
const delta = actual - target;
const passed = Math.abs(delta) <= tolerancePct;

console.log(`  target RTP    : ${target.toFixed(2)}%`);
console.log(`  client engine : ${actual.toFixed(2)}% (delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%)`);
console.log(`  tolerance     : ±${tolerancePct.toFixed(2)}%`);
console.log(`  hit rate      : ${Number(report.current.hit_frequency_percent || 0).toFixed(2)}%`);
console.log(`  bonus catch   : ${Number(report.current.bonus_catch_rate_percent || 0).toFixed(4)}%`);
console.log(`  big >=20x     : ${report.current.big_win_20x_count}`);
console.log(`  huge >=50x    : ${report.current.huge_win_50x_count}`);
console.log(`  max win x     : ${Number(report.current.max_win_x || 0).toFixed(2)}x`);
console.log(`  elapsed       : ${(elapsedMs / 1000).toFixed(1)}s`);
console.log(`  result        : ${passed ? "PASS" : "FAIL"}`);

process.exit(passed ? 0 : 1);
