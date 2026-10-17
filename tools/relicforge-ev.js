#!/usr/bin/env node
"use strict";

/**
 * Relic Forge equal-EV table (docs/relic-forge/02-tech-plan.md §4).
 *
 *   RULES=<rules.json> SPINS=200000 node tools/relicforge-ev.js [--write]
 *
 * For every draft the Forge can reach, find a Relic bonus factor per offerable relic so
 * that every option has the same expected value for the rest of the Forge. Then any pick
 * policy has the same EV and the game's RTP does not depend on the player's choices.
 *
 * Method:
 *  1. States. A draft state is (relic levels L, spins left n); evolutions follow from L
 *     (both partners at Lv3). From (0…0, 10) every pick adds one level, so a state with
 *     n spins left has picked 10 - n times.
 *  2. Per-spin value. For every relic set the Forge can play (L after a pick; Meltdown on
 *     the last spin) estimate w = E[spin pay] (bet multiples, before scalers and factors)
 *     by Monte Carlo over SPINS spins. When Surge or Magnet is already owned the spin
 *     carries a Mult / stuck specials from earlier spins: each sample first plays
 *     `age` = ceil(spins played / 2) spins with the relics owned BEFORE the pick (not
 *     counted), then the measured spin with the new set (or Meltdown). This is the
 *     bucketed approximation of the carried state (the plan's §4 fallback);
 *     MODE=policies in tools/relicforge-sim.js measures what is left of it.
 *  3. Backward induction from the last spin:
 *       U(s, r) = w(L + r) + V(L + r, n - 1)      (V(·, 0) = 0)
 *       V(s)    = max over offerable r of U(s, r)
 *       k(s, r) = V(s) / U(s, r)  ≥ 1
 *     Each pick's factor multiplies everything after it, and the later factors are
 *     already in V, so every option is worth V(s): equal EV, by construction.
 *  4. Volatility: an option's per-spin coefficient of variation against the offer's
 *     median: < 0.85 low, > 1.15 high, else medium.
 *
 * --write puts { version, factors, volatility } into the rules file's ev_table.
 * CALIBRATE=<file.json> (from MODE=calibrate in relicforge-sim.js): keep the rules'
 * table and divide each factor by its (relic, spins left, warm, level) group's measured /
 * predicted ratio RELATIVE to its layer's (spins left, warm): the relics of a layer end
 * up worth the same as played, and the layer keeps its level. Repeat until flat.
 * LOAD=<file.json> reuses a DUMP instead of simulating (same rules and SPINS).
 * DUMP=<file.json> also writes every relic set's per-spin mean and SD (balance work).
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
const RELICS = ["IGNITE", "CHAIN", "EXPAND", "MAGNET", "HOARD", "SURGE"];

function seededCrypto(seedText) {
  const h = crypto.createHash("sha256").update(seedText).digest();
  const s = new Uint32Array([h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)]);
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  const next = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 11);
    return result;
  };
  return {
    getRandomValues(view) {
      const words = new Uint32Array(view.buffer, view.byteOffset, view.byteLength >>> 2);
      for (let i = 0; i < words.length; i += 1) words[i] = next();
      const bytes = new Uint8Array(view.buffer, view.byteOffset + words.byteLength, view.byteLength & 3);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = next() & 0xff;
      return view;
    },
    randomUUID: () => "ev"
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

const key = (L) => RELICS.map((r) => L[r]).join("");
const fromKey = (k) => Object.fromEntries(RELICS.map((r, i) => [r, Number(k[i])]));

/** A worker: estimate w (mean, sd) for a list of relic sets. */
function runJobs({ jobs, spins, seed }) {
  const RF = loadEngine(seed);
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const engine = new RF.SpinEngine({ rules });
  const out = [];
  const setup = (levelsKey, meltdown) => {
    const L = fromKey(levelsKey);
    const cfg = RF.Relics.configFor(RF.Relics.effective(L, RF.Relics.newEvolutions(L, [], rules), meltdown), rules, rules.layout.rows);
    const table = RF.Grid.makeTable(Object.entries(RF.Relics.weightsFor(cfg, rules)).map(([symbol, weight]) => ({ symbol, weight })));
    return { cfg, table };
  };
  for (const job of jobs) {
    const now = setup(job.levels, job.meltdown);
    const before = job.age > 0 ? setup(job.prev, false) : now;
    let carried = null;
    let stuck = [];
    let sum = 0;
    let sumSq = 0;
    // Each sample: `age` spins of the same set to build up the carried Mult and stuck
    // specials (not counted), then the measured spin.
    for (let i = 0; i < spins * (job.age + 1); i += 1) {
      const measured = i % (job.age + 1) === job.age;
      if (i % (job.age + 1) === 0) {
        carried = null;
        stuck = [];
      }
      const warm = job.age > 0;
      // Warm-up spins play the relics owned before the pick; the measured one, after it.
      const { cfg, table } = measured ? now : before;
      const start = warm && cfg.surge > 0 && carried ? carried + cfg.carryBonus : rules.mult.start;
      const ctx = Object.assign(engine.ctxFor(table), {
        ember: null,
        rows: cfg.rows,
        wilds: cfg.wilds,
        wildMult: cfg.wildMult,
        stuck: warm ? stuck : [],
        specialBands: Object.assign({}, rules.specials, { RUNE: { min: cfg.runeMin, max: rules.specials.RUNE.max } }),
        mult: { start, inc: cfg.inc, burst: cfg.burst, max: rules.mult.max || 0, scope: rules.mult.burst_scope || "running" }
      });
      const r = RF.Round.resolveSpin(ctx, RF.RNG);
      if (warm) {
        if (cfg.surge > 0 || cfg.persistAll) carried = r.final_mult !== null ? r.final_mult : carried;
        const keep = cfg.persistAll ? 3 : cfg.stickSpins;
        stuck = stuck
          .map((s) => Object.assign({}, s, { spins_left: s.spins_left - 1 }))
          .concat(keep > 0 ? r.specials_created.map((s) => ({ up: cfg.rows - 1 - s.row, col: s.col, kind: s.kind, symbol: s.symbol, spins_left: keep })) : [])
          .filter((s) => s.spins_left > 0)
          .slice(-rules.forge.max_stuck_specials);
      }
      if (!measured) continue;
      sum += r.total_x;
      sumSq += r.total_x * r.total_x;
    }
    const mean = sum / spins;
    out.push({ id: job.id, mean, sd: Math.sqrt(Math.max(0, sumSq / spins - mean * mean)) });
  }
  return out;
}

if (!isMainThread) {
  parentPort.postMessage(runJobs(workerData));
  return;
}

async function main() {
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const spins = Number(process.env.SPINS || 200000);
  const total = rules.forge.free_spins;
  const workers = Math.max(1, Number(process.env.WORKERS || os.cpus().length));
  const t0 = Date.now();

  // 1. States reachable from the trigger, and the relic sets their options play.
  const states = new Map(); // `${key}|${n}` → { L, n }
  const sets = new Map(); // `${key}|${meltdown}|${warm}` → job
  const offerable = (L) => RELICS.filter((r) => L[r] < 3);
  // How many earlier spins could have built up a carried Mult / stuck specials: none
  // unless Surge or Magnet is owned; then about half the spins played so far (the relic
  // was picked somewhere in them). A bucketed approximation, measured by MODE=policies.
  const ageOf = (L, n) => (L.SURGE >= 1 || L.MAGNET >= 1 ? Math.ceil((total - n) / 2) : 0);
  // A cold spin depends only on the set it plays; a warm one also on the set before it.
  const setId = (L, L2, n, age) => `${key(L2)}|${n === 1 ? 1 : 0}|${age}${age > 0 ? "|" + key(L) : ""}`;
  (function walk(L, n) {
    const id = `${key(L)}|${n}`;
    if (states.has(id)) return;
    states.set(id, { L, n });
    const age = ageOf(L, n);
    for (const r of offerable(L)) {
      const L2 = Object.assign({}, L, { [r]: L[r] + 1 });
      const sid = setId(L, L2, n, age);
      if (!sets.has(sid)) sets.set(sid, { id: sid, levels: key(L2), prev: key(L), meltdown: n === 1, age });
      if (n > 1) walk(L2, n - 1);
    }
  })(Object.fromEntries(RELICS.map((r) => [r, 0])), total);
  console.error(`${states.size} draft states, ${sets.size} relic sets × ${spins.toLocaleString("en")} spins`);

  // 2. Per-spin value of every set, spread over the workers.
  const all = [...sets.values()];
  const chunks = Array.from({ length: workers }, () => []);
  all.forEach((job, i) => chunks[i % workers].push(job));
  const results = process.env.LOAD ? [JSON.parse(fs.readFileSync(process.env.LOAD, "utf8"))] : await Promise.all(
    chunks.map(
      (jobs, i) =>
        new Promise((resolve, reject) => {
          const w = new Worker(__filename, { workerData: { jobs, spins, seed: `${process.env.SEED || "relicforge-ev"}/${i}` } });
          w.once("message", resolve);
          w.once("error", reject);
        })
    )
  );
  const w = new Map(results.flat().map((r) => [r.id, r]));
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(results.flat()));

  // 3. Backward induction.
  const { evolutionsOf, sig } = signatureHelpers(rules);
  const V = new Map();
  const factors = {};
  const volatility = {};
  const values = {};
  let maxK = 1;
  const order = [...states.values()].sort((a, b) => a.n - b.n);
  for (const { L, n } of order) {
    const age = ageOf(L, n);
    const opts = offerable(L).map((r) => {
      const L2 = Object.assign({}, L, { [r]: L[r] + 1 });
      const spin = w.get(setId(L, L2, n, age));
      const later = n > 1 ? V.get(`${key(L2)}|${n - 1}`) : 0;
      return { r, U: spin.mean + later, cv: spin.mean > 0 ? spin.sd / spin.mean : 0 };
    });
    const best = Math.max(...opts.map((o) => o.U));
    V.set(`${key(L)}|${n}`, best);
    const cvs = opts.map((o) => o.cv).sort((a, b) => a - b);
    const median = cvs[Math.floor(cvs.length / 2)] || 1;
    const s = sig(L, evolutionsOf(L), n);
    values[s] = Math.round(best * 10000) / 10000;
    for (const o of opts) {
      const k = o.U > 0 ? best / o.U : 1;
      maxK = Math.max(maxK, k);
      factors[`${s}>${o.r}`] = Math.round(k * 10000) / 10000;
      volatility[`${s}>${o.r}`] = o.cv < median * 0.85 ? "low" : o.cv > median * 1.15 ? "high" : "medium";
    }
  }
  if (process.env.CALIBRATE) {
    const prev = rules.ev_table;
    const cal = JSON.parse(fs.readFileSync(process.env.CALIBRATE, "utf8"));
    // Relative calibration: within a layer (spins left, warm) only the relics move against
    // each other; the layer keeps its pick-weighted level. Correcting absolute levels
    // compounds through every later pick and diverges (seen: x13 then x0.0002).
    const layers = {};
    for (const [k, g] of Object.entries(cal)) {
      const layer = k.split("|").slice(1, 3).join("|");
      const l = (layers[layer] ||= { R: 0, V: 0 });
      l.R += g.sumR;
      l.V += g.sumV;
    }
    let min = Infinity;
    for (const k of Object.keys(prev.factors)) {
      const [s, relic] = k.split(">");
      const n = s.split("|")[2];
      // Warm: Surge or Magnet owned before the pick (signature letters M and S).
      const warm = s[7] !== "0" || s[11] !== "0" ? 1 : 0;
      // The picked relic's level before the pick (its signature letter, then the digit).
      const level = s["ICEMHS".indexOf(relic[0]) * 2 + 1];
      const c = cal[`${relic}|${n}|${warm}|${level}`];
      // Picks of this relic at this depth paid ratio = measured / predicted: scale them back.
      const l = layers[`${n}|${warm}`];
      const ratio = c && l && c.count >= Number(process.env.MIN_COUNT || 2000) ? c.sumR / c.sumV / (l.R / l.V) : 1;
      factors[k] = Math.round((prev.factors[k] / ratio) * 10000) / 10000;
      min = Math.min(min, factors[k]);
    }
    Object.assign(volatility, prev.volatility);
    Object.assign(values, prev.values);
    console.error(`calibrated ${Object.keys(cal).length} groups; min factor ${min.toFixed(4)}`);
  }
  const start = V.get(`${key(Object.fromEntries(RELICS.map((r) => [r, 0])))}|${total}`);
  const table = {
    version: `ev-${new Date().toISOString().slice(0, 10)}-${crypto.createHash("sha256").update(JSON.stringify(factors)).digest("hex").slice(0, 8)}`,
    method: "backward induction over draft states; per-spin values by Monte Carlo (cold / warm carry buckets); tools/relicforge-ev.js",
    spins_per_set: spins,
    forge_value_x: Math.round(start * 1000) / 1000,
    factors,
    volatility,
    // V(s): the predicted rest-of-Forge value at each draft (raw units: before scalers and
    // before the Relic bonus already collected). Calibration compares play against it.
    values
  };
  console.error(`done in ${Math.round((Date.now() - t0) / 1000)}s: Forge value ${start.toFixed(3)}x (raw, before scalers), ${Object.keys(factors).length} factors, max factor ${maxK.toFixed(3)}`);
  if (process.argv.includes("--write")) {
    rules.ev_table = table;
    fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2) + "\n");
    console.error(`written to ${RULES_PATH}`);
  } else {
    console.log(JSON.stringify({ version: table.version, forge_value_x: table.forge_value_x, factors: Object.keys(factors).length, maxK }));
  }
}

/** The engine's own signature (ev-table.js), so the keys match what the engine looks up. */
function signatureHelpers(rules) {
  const RF = loadEngine("sig");
  return {
    evolutionsOf: (L) => [...RF.Relics.newEvolutions(L, [], rules)],
    sig: (L, evolutions, n) => RF.EvTable.signature(L, evolutions, n)
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
