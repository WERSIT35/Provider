// Glasshouse: seeded Monte Carlo report over the real engine file (engine/engine.js), loaded
// in a vm context exactly as the RGS loads it, with a fast seeded PRNG as `crypto`.
//   node games/glasshouse/tools/sim-report.js [--spins 100000000] [--variant glasshouse]
//        [--mode base|buy] [--workers N] [--seed glasshouse] [--json out.json]
// One sample = one paid spin INCLUDING the whole feature it triggers (mode base), or one
// feature buy including its whole feature (mode buy): the unit a player pays for. Shards are
// fixed (20), so results do not depend on the machine. Exits 0; the report says PASS/FAIL
// against the variant's target (rules.json) when one is set.
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const GAME = path.join(__dirname, "..");
const SHARDS = 20;
const EDGES = [0, 0.000001, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000];

function xoshiro(seedText) {
  const h = crypto.createHash("sha256").update(seedText).digest();
  const s = new Uint32Array([h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)]);
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  const next = () => {
    const r = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return r;
  };
  return {
    getRandomValues(view) {
      if (view && view.BYTES_PER_ELEMENT === 4) { for (let i = 0; i < view.length; i++) view[i] = next(); return view; }
      const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      for (let i = 0; i < b.length; i += 4) { const w = next(); for (let k = 0; k < 4 && i + k < b.length; k++) b[i + k] = (w >>> (8 * k)) & 0xff; }
      return view;
    }
  };
}

function loadEngine(seed) {
  const manifest = JSON.parse(fs.readFileSync(path.join(GAME, "game.json"), "utf8"));
  const sandbox = { crypto: xoshiro(seed), console };
  const ctx = vm.createContext(sandbox);
  for (const f of manifest.engine.files) new vm.Script(fs.readFileSync(path.join(GAME, manifest.engine.dir, f), "utf8"), { filename: f }).runInContext(ctx);
  return sandbox[manifest.engine.namespace];
}

/** One shard. `rules` may be passed in (tuning); otherwise math/rules.json. */
function runShard({ seed, samples, variant, mode, rules }) {
  const ns = loadEngine(seed);
  rules = rules || JSON.parse(fs.readFileSync(path.join(GAME, "math", "rules.json"), "utf8"));
  const engine = new ns.SpinEngine({ rules });
  engine.initSession({ game_id: variant, balance: 1e15 });
  const bet = 1;
  const a = {
    samples, sum: 0, sumSq: 0, hits: 0, features: 0, featureSpins: 0, featureWin: 0, triggerWin: 0, baseWin: 0,
    scatterWin: 0, lensSpins: 0, lensWin: 0, beams: 0, beamCells: 0, doubleLens: 0, retriggers: 0, capHits: 0,
    stickyEnd: 0, fullHouse: 0, max: 0, maxAt: -1, buyDraws: 0
  };
  const distCount = new Array(EDGES.length).fill(0), distWin = new Array(EDGES.length).fill(0);
  const note = (r) => {
    if (r.beams.length) {
      a.beams += r.beams.length;
      for (const b of r.beams) a.beamCells += b.path.length;
      if (r.beams.length > 1) a.doubleLens++;
    }
  };
  for (let i = 0; i < samples; i++) {
    let r = mode === "buy" ? engine.buyFreeSpins({ bet_amount: bet }) : engine.spin({ bet_amount: bet });
    if (mode === "buy") a.buyDraws += r.buy_draws;
    note(r);
    let w = r.total_win;
    a.baseWin += w;
    a.scatterWin += r.scatter.amount;
    if (r.beams.length) { a.lensSpins++; a.lensWin += w - r.scatter.amount; }
    let capped = r.events.some((e) => e.type === "MAX_WIN_CAP");
    if (r.free_spins_left > 0) {
      a.features++;
      a.triggerWin += w;
      let fw = 0;
      let lastSticky = 0;
      while (r.free_spins_left > 0) {
        r = engine.spin({ bet_amount: bet });
        note(r);
        fw += r.total_win;
        a.featureSpins++;
        if (r.events.some((e) => e.type === "FREE_SPINS_RETRIGGERED")) a.retriggers++;
        if (r.events.some((e) => e.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP")) capped = true;
        lastSticky = r.feature_state ? r.feature_state.sticky.length : (r.sticky_in.length + r.lit.filter(([rr, cc]) => !r.sticky_in.some(([sr, sc]) => sr === rr && sc === cc)).length);
      }
      a.stickyEnd += lastSticky;
      if (lastSticky >= 24) a.fullHouse++;
      a.featureWin += fw;
      w += fw;
    }
    if (capped) a.capHits++;
    const x = w / bet;
    a.sum += x; a.sumSq += x * x;
    if (x > 0) a.hits++;
    if (x > a.max) { a.max = x; a.maxAt = i; }
    let b = 0; while (b + 1 < EDGES.length && x >= EDGES[b + 1]) b++;
    distCount[b]++; distWin[b] += x;
  }
  return Object.assign(a, { distCount, distWin });
}

function merge(results) {
  const t = {};
  for (const r of results) for (const [k, v] of Object.entries(r)) {
    if (Array.isArray(v)) t[k] = (t[k] || new Array(v.length).fill(0)).map((x, i) => x + v[i]);
    else if (k === "max") t.max = Math.max(t.max || 0, v);
    else if (k !== "maxAt") t[k] = (t[k] || 0) + v;
  }
  return t;
}

function summarize(t, { mode, cost }) {
  const n = t.samples;
  const mean = t.sum / n;
  const sd = Math.sqrt(Math.max(0, t.sumSq / n - mean * mean));
  const se = sd / Math.sqrt(n);
  const pct = (x) => (100 * x) / cost;
  return {
    samples: n, rtp: pct(mean), ci99: [pct(mean - 2.5758 * se), pct(mean + 2.5758 * se)], se: pct(se), sd: sd / cost,
    hitRate: t.hits / n,
    baseRtp: mode === "base" ? pct(t.baseWin / n) : null,
    featureRtp: pct(t.featureWin / n),
    triggerRtp: mode === "buy" ? pct(t.baseWin / n) : null,
    scatterRtp: pct(t.scatterWin / n),
    lensRate: t.lensSpins / n, lensRtp: pct(t.lensWin / n),
    featureOneIn: t.features ? n / t.features : null,
    avgFeatureWin: t.features ? (t.featureWin + t.triggerWin) / t.features : null,
    avgFeatureSpins: t.features ? t.featureSpins / t.features : null,
    retriggerPerFeature: t.features ? t.retriggers / t.features : null,
    cellsPerBeam: t.beams ? t.beamCells / t.beams : null,
    doubleLensSpins: t.doubleLens,
    stickyAtEnd: t.features ? t.stickyEnd / t.features : null,
    fullHouse: t.fullHouse, capHits: t.capHits, max: t.max,
    buyDrawsAvg: mode === "buy" ? t.buyDraws / n : null,
    dist: EDGES.map((e, i) => ({ from: e, count: t.distCount[i], rtp: pct(t.distWin[i] / n) }))
  };
}

/** In-process run (tuning): one thread, `rules` object, returns the summary. */
function simulate(rules, { spins = 1e6, variant, mode = "base", seed = "tune" } = {}) {
  const per = Math.ceil(spins / 4);
  const res = [0, 1, 2, 3].map((i) => runShard({ seed: `${seed}/${i}`, samples: per, variant: variant || rules.rtp_profiles[0].game_id, mode, rules }));
  return summarize(merge(res), { mode, cost: mode === "buy" ? rules.buy.cost_x : 1 });
}

if (!isMainThread) {
  parentPort.postMessage(runShard(workerData));
} else if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const spins = Number(arg("spins", 10_000_000));
  const variant = arg("variant", "glasshouse");
  const mode = arg("mode", "base");
  const seed = arg("seed", "glasshouse");
  const workers = Number(arg("workers", Math.max(1, os.cpus().length)));
  const jsonOut = arg("json", "");
  const rules = JSON.parse(fs.readFileSync(path.join(GAME, "math", "rules.json"), "utf8"));
  const jobs = Array.from({ length: SHARDS }, (_, i) => ({ seed: `${seed}/${variant}/${mode}/${i}`, samples: Math.floor(spins / SHARDS) + (i < spins % SHARDS ? 1 : 0), variant, mode }));
  const t0 = Date.now();
  const results = [];
  let next = 0;
  const launch = () => {
    if (next >= jobs.length) return null;
    const job = jobs[next++];
    return new Promise((resolve, reject) => {
      const w = new Worker(__filename, { workerData: job });
      w.once("message", (r) => { results.push(r); resolve(); });
      w.once("error", reject);
    }).then(launch);
  };
  Promise.all(Array.from({ length: workers }, launch)).then(() => {
    const s = summarize(merge(results), { mode, cost: mode === "buy" ? rules.buy.cost_x : 1 });
    const profile = rules.rtp_profiles.find((p) => p.game_id === variant) || rules.rtp_profiles[0];
    const out = {
      game: "glasshouse", variant, mode, seed, shards: SHARDS, engine_version: loadEngine("v").ENGINE_VERSION,
      rules_version: rules.version, seconds: Math.round((Date.now() - t0) / 1000), ...s,
      target: mode === "buy" ? profile.buy_free_spins_percent : profile.theoretical_percent
    };
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2) + "\n");
    const f = (x, d = 4) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));
    console.log(`${variant} ${mode}: ${s.samples.toLocaleString()} samples in ${out.seconds}s`);
    console.log(`  RTP ${f(s.rtp)}%  99% CI [${f(s.ci99[0])}, ${f(s.ci99[1])}]  SE ${f(s.se)}  SD ${f(s.sd, 2)}`);
    console.log(`  hit ${f(100 * s.hitRate, 2)}%  base ${f(s.baseRtp, 2)}%  feature ${f(s.featureRtp, 2)}%  scatter ${f(s.scatterRtp, 2)}%  lens ${f(100 * s.lensRate, 2)}% of spins (${f(s.lensRtp, 2)}% RTP)`);
    console.log(`  feature 1 in ${f(s.featureOneIn, 1)}  avg feature ${f(s.avgFeatureWin, 2)}x  spins ${f(s.avgFeatureSpins, 2)}  retriggers ${f(s.retriggerPerFeature, 3)}  sticky at end ${f(s.stickyAtEnd, 2)}  full house ${s.fullHouse}`);
    console.log(`  cells/beam ${f(s.cellsPerBeam, 2)}  double-lens spins ${s.doubleLensSpins}  cap hits ${s.capHits}  max ${f(s.max, 2)}x`);
  });
}
module.exports = { simulate, runShard, summarize, merge, EDGES };
