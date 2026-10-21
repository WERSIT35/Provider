// Tuning aid: the expected value of the free spins alone (x bet), by trigger size (8 / 12 / 16
// spins), played straight from the start state. The free reels are the same in every variant,
// so a variant's RTP = its base part + sum over k of P(trigger k) x E(feature k).
//   node games/clockwork/tools/feature-value.js [features per size, default 300000]
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { loadEngine } = require("./sim-report");

const GAME = path.join(__dirname, "..");
function run({ seed, n, spins }) {
  const ns = loadEngine(seed);
  const rules = JSON.parse(fs.readFileSync(path.join(GAME, "math", "rules.json"), "utf8"));
  const e = new ns.SpinEngine({ rules });
  e.initSession({ game_id: "clockwork", balance: 1e15 });
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    e.session.freeSpinsLeft = spins; e.session.featureState = { wound: [] }; e.session.bonusRoundWin = 0;
    let w = 0, r;
    do { r = e.spin({ bet_amount: 1 }); w += r.total_win; } while (r.free_spins_left > 0);
    sum += w; sumSq += w * w;
  }
  return { n, sum, sumSq };
}
if (!isMainThread) parentPort.postMessage(run(workerData));
else {
  const per = Number(process.argv[2] || 300000);
  const sizes = JSON.parse(fs.readFileSync(path.join(GAME, "math", "rules.json"), "utf8")).free_spins.awards;
  const W = Math.max(1, os.cpus().length);
  (async () => {
    for (const spins of sizes) {
      const parts = await Promise.all(Array.from({ length: W }, (_, i) => new Promise((res, rej) => {
        const w = new Worker(__filename, { workerData: { seed: `fv/${spins}/${i}`, n: Math.ceil(per / W), spins } });
        w.once("message", res); w.once("error", rej);
      })));
      const n = parts.reduce((t, p) => t + p.n, 0), s = parts.reduce((t, p) => t + p.sum, 0), q = parts.reduce((t, p) => t + p.sumSq, 0);
      const mean = s / n, sd = Math.sqrt(q / n - mean * mean);
      console.log(`${spins} spins: E ${mean.toFixed(3)}x  SE ${(sd / Math.sqrt(n)).toFixed(3)}  SD ${sd.toFixed(1)}  (${n} features)`);
    }
  })();
}
