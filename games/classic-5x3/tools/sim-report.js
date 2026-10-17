// classic-5x3: seeded Monte Carlo report over the real engine file (engine/engine.js),
// loaded in a vm context exactly as the RGS loads it, with a fast seeded PRNG as `crypto`.
//   node games/classic-5x3/tools/sim-report.js [--spins 100000000] [--variant classic-5x3] [--workers 2] [--seed classic] [--json out.json]
// One sample = one paid spin INCLUDING the whole free-spins feature it triggers (the RTP
// unit a player pays for). Reports RTP with a 99% confidence interval, hit frequency,
// standard deviation and volatility index, the win distribution, feature stats and the
// largest win observed. Shards are fixed (20) so results do not depend on the machine.
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
      if (view instanceof Uint32Array || (view && view.constructor && view.constructor.name === "Uint32Array")) { for (let i = 0; i < view.length; i++) view[i] = next(); return view; }
      const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      for (let i = 0; i < b.length; i += 4) { const w = next(); for (let k = 0; k < 4 && i + k < b.length; k++) b[i + k] = (w >>> (8 * k)) & 0xff; }
      return view;
    }
  };
}

function runShard({ seed, samples, variant }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(GAME, "game.json"), "utf8"));
  const sandbox = { crypto: xoshiro(seed), console };
  const ctx = vm.createContext(sandbox);
  for (const f of manifest.engine.files) new vm.Script(fs.readFileSync(path.join(GAME, manifest.engine.dir, f), "utf8"), { filename: f }).runInContext(ctx);
  const rules = JSON.parse(fs.readFileSync(path.join(GAME, manifest.rules), "utf8"));
  const engine = new sandbox.SlotEngine.SpinEngine({ rules });
  engine.initSession({ game_id: variant, balance: 1e15 });
  const bet = 1;
  let sum = 0, sumSq = 0, hits = 0, features = 0, featureSpins = 0, featureWin = 0, baseWin = 0, capHits = 0, max = 0, maxAt = -1;
  const distCount = new Array(EDGES.length).fill(0), distWin = new Array(EDGES.length).fill(0);
  for (let i = 0; i < samples; i++) {
    let r = engine.spin({ bet_amount: bet });
    let w = r.total_win;
    baseWin += w;
    if (r.free_spins_left > 0) {
      features++;
      let fw = 0;
      while (r.free_spins_left > 0) { r = engine.spin({ bet_amount: bet }); fw += r.total_win; featureSpins++; }
      featureWin += fw;
      w += fw;
    }
    if (r.events.some((e) => e.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP" || e.type === "MAX_WIN_CAP")) capHits++;
    const x = w / bet;
    sum += x; sumSq += x * x;
    if (x > 0) hits++;
    if (x > max) { max = x; maxAt = i; }
    let b = 0; while (b + 1 < EDGES.length && x >= EDGES[b + 1]) b++;
    distCount[b]++; distWin[b] += x;
  }
  return { samples, sum, sumSq, hits, features, featureSpins, featureWin, baseWin, capHits, max, maxAt, distCount, distWin };
}

if (!isMainThread) {
  parentPort.postMessage(runShard(workerData));
} else {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const SPINS = Number(arg("spins", 10_000_000));
  const VARIANT = arg("variant", "classic-5x3");
  const SEED = arg("seed", "classic-5x3");
  const WORKERS = Number(arg("workers", Math.max(1, os.cpus().length)));
  const JSON_OUT = arg("json", "");
  const t0 = Date.now();
  const per = Math.floor(SPINS / SHARDS);
  const jobs = Array.from({ length: SHARDS }, (_, i) => ({ seed: `${SEED}/${VARIANT}/${i}`, samples: i < SHARDS - 1 ? per : SPINS - per * (SHARDS - 1), variant: VARIANT }));
  const results = [];
  let next = 0;
  const runOne = () => new Promise((resolve, reject) => {
    if (next >= jobs.length) return resolve();
    const job = jobs[next++];
    const w = new Worker(__filename, { workerData: job });
    w.once("message", (m) => { results.push(m); process.stderr.write(`  shard ${results.length}/${SHARDS}\r`); w.terminate(); runOne().then(resolve, reject); });
    w.once("error", reject);
  });
  Promise.all(Array.from({ length: WORKERS }, runOne)).then(() => {
    const t = results.reduce((a, r) => {
      for (const k of ["samples", "sum", "sumSq", "hits", "features", "featureSpins", "featureWin", "baseWin", "capHits"]) a[k] = (a[k] || 0) + r[k];
      if (r.max > (a.max || 0)) a.max = r.max;
      a.distCount = (a.distCount || new Array(EDGES.length).fill(0)).map((v, i) => v + r.distCount[i]);
      a.distWin = (a.distWin || new Array(EDGES.length).fill(0)).map((v, i) => v + r.distWin[i]);
      return a;
    }, {});
    const n = t.samples, mean = t.sum / n, sd = Math.sqrt(Math.max(0, t.sumSq / n - mean * mean)), se = sd / Math.sqrt(n);
    const rules = JSON.parse(fs.readFileSync(path.join(GAME, "math", "rules.json"), "utf8"));
    const lines = (rules.rtp_profiles.find((p) => p.game_id === VARIANT) || rules.rtp_profiles[0]).lines;
    const out = {
      game: "classic-5x3", variant: VARIANT, lines, seed: SEED, samples: n, shards: SHARDS, engine: "engine/engine.js (vm context, seeded xoshiro128**)",
      theoretical_rtp: rules.theoretical_rtp, target_rtp: rules.target_rtp,
      rtp: +(100 * mean).toFixed(4), se: +(100 * se).toFixed(4), ci99: [+(100 * (mean - 2.5758 * se)).toFixed(4), +(100 * (mean + 2.5758 * se)).toFixed(4)],
      base_game_rtp: +(100 * t.baseWin / n).toFixed(4), free_spins_rtp: +(100 * t.featureWin / n).toFixed(4),
      hit_frequency: +(100 * t.hits / n).toFixed(3), hit_1_in: +(n / t.hits).toFixed(2),
      sd_x: +sd.toFixed(3), volatility_index_90: +(1.645 * sd).toFixed(3),
      feature_1_in: +(n / t.features).toFixed(1), avg_feature_spins: +(t.featureSpins / t.features).toFixed(2), avg_feature_win_x: +(t.featureWin / t.features).toFixed(2),
      max_win_x: rules.max_win_x, max_win_observed_x: +t.max.toFixed(2), cap_hits: t.capHits,
      distribution: EDGES.map((e, i) => ({ from_x: e, to_x: EDGES[i + 1] ?? null, share_pct: +(100 * t.distCount[i] / n).toFixed(5), rtp_pct: +(100 * t.distWin[i] / n).toFixed(4) })),
      seconds: Math.round((Date.now() - t0) / 1000)
    };
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify(out, null, 2));
  }, (e) => { console.error(e); process.exit(1); });
}
