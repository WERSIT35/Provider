// Server load test: N real players (signed operator launch → session → spin loop).
//
//   node tools/bench/load.mjs --players 500 --duration 60 --think-min 2000 --think-max 4000 [--wallet webhook] [--pg]
//   node tools/bench/load.mjs --matrix          # the docs/perf-baseline.md server table
//
// --think-max 0 = no think time (finds the ceiling). --pg needs BENCH_DATABASE_URL
// (a database whose name contains "bench"; it is wiped). Writes qa/bench/load*.json.
import { args, benchDbUrl, launchPlayer, openSession, quantiles, resetBenchDb, sleep, startMockCasino, startServer, writeResult } from "./common.mjs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function runLoad({ players, duration, thinkMin, thinkMax, wallet = "sandbox", pg = false, label }) {
  const dbUrl = pg ? benchDbUrl() : null;
  if (pg && !dbUrl) throw new Error("--pg needs BENCH_DATABASE_URL (see tools/bench/README.md)");
  if (dbUrl) await resetBenchDb(dbUrl);
  const casino = wallet === "webhook" ? await startMockCasino() : null;
  const srv = await startServer({ BENCH_WALLET: wallet, ...(dbUrl ? { DATABASE_URL: dbUrl } : {}) });
  try {
    const base = `http://127.0.0.1:${srv.cred.port}`;

    const tokens = [];
    for (let i = 0; i < players; i += 20) {
      const batch = Array.from({ length: Math.min(20, players - i) }, (_, k) => i + k);
      tokens.push(...(await Promise.all(batch.map(async (n) => openSession(srv.cred, await launchPlayer(srv.cred, `p${n}`))))));
    }

    const lat = []; const errors = {}; let ok = 0;
    const startedAt = Date.now(); const end = startedAt + duration * 1000;
    const think = () => thinkMin + Math.random() * (thinkMax - thinkMin);
    const player = async (tok) => {
      if (thinkMax > 0) await sleep(Math.random() * thinkMax); // stagger
      while (Date.now() < end) {
        const t0 = performance.now();
        try {
          const r = await fetch(`${base}/game/v1/spin`, { method: "POST", body: '{"bet_amount":1}',
            headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": randomUUID() } });
          const j = await r.json();
          if (r.status === 200) ok++;
          else errors[`${r.status}:${j?.error?.code}`] = (errors[`${r.status}:${j?.error?.code}`] ?? 0) + 1;
        } catch (e) { errors[`net:${e.cause?.code ?? e.message}`] = (errors[`net:${e.cause?.code ?? e.message}`] ?? 0) + 1; }
        lat.push(performance.now() - t0);
        if (thinkMax > 0) await sleep(think());
      }
    };
    await Promise.all(tokens.map(player));
    const secs = (Date.now() - startedAt) / 1000;
    const rss = srv.samples.map((s) => s.rss); const cpu = srv.samples.map((s) => s.cpuPct);
    return {
      label: label ?? `${wallet}${pg ? "+pg" : ""}-${players}${thinkMax > 0 ? "" : "-sat"}`,
      config: { players, durationS: duration, thinkMs: [thinkMin, thinkMax], wallet, postgres: !!pg },
      spins: ok, spinsPerSec: +(ok / secs).toFixed(1), errors, latencyMs: quantiles(lat),
      serverRssMB: { start: rss.length ? +(rss[0] / 1048576).toFixed(0) : null, max: rss.length ? +(Math.max(...rss) / 1048576).toFixed(0) : null },
      serverCpuPctMax: cpu.length ? Math.max(...cpu) : null
    };
  } finally {
    srv.child.kill(); casino?.kill();
    await sleep(500);
  }
}

const MATRIX = [
  { players: 50, thinkMin: 2000, thinkMax: 4000 },
  { players: 200, thinkMin: 2000, thinkMax: 4000 },
  { players: 500, thinkMin: 2000, thinkMax: 4000 },
  { players: 100, thinkMin: 0, thinkMax: 0 },
  { players: 500, thinkMin: 2000, thinkMax: 4000, wallet: "webhook" },
  { players: 100, thinkMin: 0, thinkMax: 0, wallet: "webhook" },
  { players: 500, thinkMin: 2000, thinkMax: 4000, pg: true },
  { players: 100, thinkMin: 0, thinkMax: 0, pg: true },
  { players: 50, thinkMin: 2000, thinkMax: 4000, wallet: "webhook", pg: true },
  { players: 200, thinkMin: 2000, thinkMax: 4000, wallet: "webhook", pg: true },
  { players: 500, thinkMin: 2000, thinkMax: 4000, wallet: "webhook", pg: true }
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args({ players: 50, duration: 60, "think-min": 2000, "think-max": 4000, wallet: "sandbox", pg: false });
  const runs = [];
  const plan = a.matrix ? MATRIX.filter((m) => !m.pg || benchDbUrl()) : [{ players: a.players, thinkMin: a["think-min"], thinkMax: a["think-max"], wallet: a.wallet, pg: a.pg }];
  if (a.matrix && plan.length < MATRIX.length) console.error("BENCH_DATABASE_URL not set: skipping the Postgres rows.");
  for (const p of plan) {
    const r = await runLoad({ duration: a.duration, ...p });
    runs.push(r);
    console.log(`${r.label.padEnd(22)} ${String(r.spinsPerSec).padStart(7)} spins/s  p50 ${r.latencyMs.p50}  p95 ${r.latencyMs.p95}  p99 ${r.latencyMs.p99}  max ${r.latencyMs.max} ms  errors ${Object.values(r.errors).reduce((x, y) => x + y, 0)}  rss ${r.serverRssMB.max} MB`);
  }
  console.log("→", writeResult(a.matrix ? "load-matrix" : `load-${runs[0].label}`, { runs }));
  process.exit(0);
}
