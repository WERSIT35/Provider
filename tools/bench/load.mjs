// Server load test: N real players (signed operator launch → session → spin loop).
//
//   node tools/bench/load.mjs --players 500 --duration 60 --think-min 2000 --think-max 4000 [--wallet webhook] [--pg]
//   node tools/bench/load.mjs --matrix          # the docs/perf-baseline.md server table
//
// Soak: --duration 7200 (RSS per minute + a flatness verdict; BENCH_MEM_CGROUP caps memory).
// --think-max 0 = no think time (finds the ceiling). --pg needs BENCH_DATABASE_URL
// (a database whose name contains "bench"; it is wiped). Writes qa/bench/load*.json.
import { args, benchDbUrl, launchPlayer, openSession, quantiles, resetBenchDb, sleep, startMockCasino, startServer, writeResult, request, pinGeneratorSide } from "./common.mjs";
pinGeneratorSide();
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
    const cpu0 = process.cpuUsage();
    const think = () => thinkMin + Math.random() * (thinkMax - thinkMin);
    const player = async (tok, n) => {
      if (thinkMax > 0) await sleep(Math.random() * thinkMax); // stagger
      while (Date.now() < end) {
        const t0 = performance.now();
        try {
          const r = await request(`${base}/game/v1/spin`, { method: "POST", body: '{"bet_amount":1}',
            headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": randomUUID() } });
          const j = r.json;
          if (r.status === 200) ok++;
          else {
            errors[`${r.status}:${j?.error?.code}`] = (errors[`${r.status}:${j?.error?.code}`] ?? 0) + 1;
            // What a real client does on a long run: the casino relaunches an expired
            // session (tokens live 1 h); the player acknowledges a reality check.
            if (r.status === 401) tok = await openSession(srv.cred, await launchPlayer(srv.cred, `p${n}`));
            else if (j?.error?.code === "REALITY_CHECK_REQUIRED") await request(`${base}/game/v1/reality-check/ack`, { method: "POST", headers: { authorization: `Bearer ${tok}` } });
          }
        } catch (e) { errors[`net:${e.cause?.code ?? e.message}`] = (errors[`net:${e.cause?.code ?? e.message}`] ?? 0) + 1; }
        lat.push(performance.now() - t0);
        if (thinkMax > 0) await sleep(think());
      }
    };
    await Promise.all(tokens.map((t, n) => player(t, n)));
    const secs = (Date.now() - startedAt) / 1000;
    const cpu = process.cpuUsage(cpu0);
    // The generator's own CPU: near a full core, the ceiling measured is the generator's, not the server's.
    const generatorCpuPct = +(((cpu.user + cpu.system) / 1000 / (secs * 1000)) * 100).toFixed(1);
    const rss = srv.samples.map((s) => s.rss); const serverCpu = srv.samples.map((s) => s.cpuPct);
    // RSS per minute (median of the 2 s samples). On long runs, the soak verdict: the
    // last 10 minutes vs minutes 10–20 (after warm-up), flat within ±10%.
    const perMin = [];
    for (let i = 0; i < rss.length; i += 30) perMin.push(+(median(rss.slice(i, i + 30)) / 1048576).toFixed(0));
    const soak = perMin.length >= 30 ? (() => {
      const warm = median(perMin.slice(10, 20)); const last = median(perMin.slice(-10));
      const driftPct = +(((last - warm) / warm) * 100).toFixed(1);
      return { warmMB: warm, lastMB: last, driftPct, flat: Math.abs(driftPct) <= 10, serverAlive: srv.child.exitCode === null };
    })() : undefined;
    return {
      label: label ?? `${wallet}${pg ? "+pg" : ""}-${players}${thinkMax > 0 ? "" : "-sat"}`,
      config: { players, durationS: duration, thinkMs: [thinkMin, thinkMax], wallet, postgres: !!pg },
      spins: ok, spinsPerSec: +(ok / secs).toFixed(1), errors, latencyMs: quantiles(lat),
      serverRssMB: { start: rss.length ? +(rss[0] / 1048576).toFixed(0) : null, max: rss.length ? +(Math.max(...rss) / 1048576).toFixed(0) : null },
      serverCpuPctMax: serverCpu.length ? Math.max(...serverCpu) : null,
      // Main-thread stalls (per 2 s sample): the median sample's p99, and the worst stall seen.
      eventLoopDelayMs: srv.samples.length ? { p99Median: median(srv.samples.map((x) => x.loopDelayP99Ms ?? 0)), max: Math.max(...srv.samples.map((x) => x.loopDelayMaxMs ?? 0)) } : null,
      gc: srv.samples.length ? { pauseMaxMs: Math.max(...srv.samples.map((x) => x.gcMaxMs ?? 0)), pctMedian: median(srv.samples.map((x) => x.gcPct ?? 0)),
        maxByKind: srv.samples.reduce((acc, x) => { for (const [k, v] of Object.entries(x.gcMaxByKind ?? {})) acc[k] = Math.max(acc[k] ?? 0, v); return acc; }, {}) } : null,
      ...(duration >= 600 ? { serverRssPerMinMB: perMin } : {}),
      ...(soak ? { soak } : {}),
      generatorCpuPct,
      generatorBound: generatorCpuPct > 85
    };
  } finally {
    srv.child.kill(); casino?.kill();
    await sleep(500);
  }
}

const median = (xs) => { const v = [...xs].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : 0; };

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
  { players: 500, thinkMin: 2000, thinkMax: 4000, wallet: "webhook", pg: true },
  // The production path's ceiling (casino wallet + Postgres, no think time).
  { players: 100, thinkMin: 0, thinkMax: 0, wallet: "webhook", pg: true }
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args({ players: 50, duration: 60, "think-min": 2000, "think-max": 4000, wallet: "sandbox", pg: false });
  const runs = [];
  const plan = a.matrix ? MATRIX.filter((m) => !m.pg || benchDbUrl()) : [{ players: a.players, thinkMin: a["think-min"], thinkMax: a["think-max"], wallet: a.wallet, pg: a.pg }];
  if (a.matrix && plan.length < MATRIX.length) console.error("BENCH_DATABASE_URL not set: skipping the Postgres rows.");
  for (const p of plan) {
    const r = await runLoad({ duration: a.duration, ...p });
    runs.push(r);
    console.log(`${r.label.padEnd(22)} ${String(r.spinsPerSec).padStart(7)} spins/s  p50 ${r.latencyMs.p50}  p95 ${r.latencyMs.p95}  p99 ${r.latencyMs.p99}  max ${r.latencyMs.max} ms  errors ${Object.values(r.errors).reduce((x, y) => x + y, 0)}  rss ${r.serverRssMB.max} MB  server cpu ${r.serverCpuPctMax}%  gen cpu ${r.generatorCpuPct}%${r.generatorBound ? " (GENERATOR-BOUND)" : ""}`);
  }
  if (runs[0].soak) console.log("soak:", runs[0].soak);
  console.log("→", writeResult(a.matrix ? "load-matrix" : `${runs[0].soak ? "soak" : "load"}-${runs[0].label}`, { runs }));
  process.exit(0);
}
