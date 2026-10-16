// Shared helpers for the bench suite (tools/bench). Node 22+, no extra deps:
// it reuses the built platform (platform/dist) and the platform's own `pg`.
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BENCH_DIR = join(ROOT, "tools", "bench");
export const DIST = join(ROOT, "platform", "dist");
export const OUT_DIR = join(ROOT, "qa", "bench");

export function requireDist() {
  if (!existsSync(join(DIST, "app.js"))) {
    console.error("platform/dist is missing. Run: npm --prefix platform run build");
    process.exit(2);
  }
}

export const importDist = (rel) => import(pathToFileURL(join(DIST, rel)).href);
export const requirePlatform = createRequire(join(ROOT, "platform", "package.json"));

/** Parse --key value / --flag CLI args into an object (numbers coerced). */
export function args(defaults = {}) {
  const out = { ...defaults };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true";
    out[k] = v === "true" ? true : v === "false" ? false : Number.isFinite(Number(v)) && v !== "" ? Number(v) : v;
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * HTTP for the load generator: an explicit keep-alive pool, like a casino's players'
 * browsers. (Node's built-in fetch drops a connection idle for 4 s; with 2–4 s of think
 * time almost every spin would open a new TCP connection and the server would be
 * measured on connection churn instead of spins.)
 */
const agent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: Infinity, maxFreeSockets: 4096, timeout: 60_000 });
export function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, agent, headers: body ? { ...headers, "content-length": Buffer.byteLength(body) } : headers },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { /* not JSON */ }
          resolve({ status: res.statusCode, json, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export function quantiles(values) {
  const a = [...values].sort((x, y) => x - y);
  const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : null);
  return { n: a.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a.length ? +a[a.length - 1].toFixed(2) : null };
}

/** Writes qa/bench/<name>.json (and a timestamped copy under qa/bench/runs/). */
export function writeResult(name, data) {
  mkdirSync(join(OUT_DIR, "runs"), { recursive: true });
  const body = JSON.stringify({ name, at: new Date().toISOString(), node: process.version, ...data }, null, 2) + "\n";
  writeFileSync(join(OUT_DIR, `${name}.json`), body);
  writeFileSync(join(OUT_DIR, "runs", `${name}-${Date.now()}.json`), body);
  return join(OUT_DIR, `${name}.json`);
}

/**
 * Linux only, opt-in: BENCH_PIN=1 pins the server to core 0 and everything else —
 * including the process running the load generator itself — to core 1, so the load
 * never steals the server's core (emulates a 2-vCPU box with a remote client).
 * Called by the generator scripts only: the server imports this module too and must
 * NOT move itself.
 */
export function pinGeneratorSide() {
  if (process.env.BENCH_PIN !== "1" || process.platform !== "linux") return;
  try { execFileSync("taskset", ["-pc", "1", String(process.pid)], { stdio: "ignore" }); } catch { /* taskset missing: unpinned */ }
  // A local Postgres goes to core 1 too, so the platform's core is its own (best effort:
  // needs permission over the postgres processes; a containerised DB is left alone).
  try {
    const pids = execFileSync("pgrep", ["-u", "postgres"], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const pid of pids) try { execFileSync("taskset", ["-pc", "1", pid], { stdio: "ignore" }); } catch { /* not ours */ }
  } catch { /* no local postgres */ }
}
/** Linux only, opt-in: BENCH_PIN=1 pins the server to core 0 and the rest to core 1. */
export function pinned(cmd, argv, core) {
  if (process.env.BENCH_PIN === "1" && process.platform === "linux") return ["taskset", ["-c", String(core), cmd, ...argv]];
  return [cmd, argv];
}

/**
 * Starts tools/bench/server.mjs as a child with IPC. Resolves once it is listening,
 * with { child, cred, samples } — samples collects { rss, cpu } every 2 s.
 */
export async function startServer(env = {}) {
  requireDist();
  // spawn + "ipc" (not fork) so the Linux-only taskset wrapper still gets the IPC fd.
  const [cmd, argv] = pinned(process.execPath, [join(BENCH_DIR, "server.mjs")], 0);
  const child = spawn(cmd, argv, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  // BENCH_MEM_CGROUP=/sys/fs/cgroup/memory/<group> (cgroup v1, limit set beforehand):
  // the server runs under a real memory cap, like a 2 GB box.
  const cg = env.BENCH_MEM_CGROUP ?? process.env.BENCH_MEM_CGROUP;
  if (cg) writeFileSync(join(cg, "cgroup.procs"), String(child.pid));
  const samples = [];
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const cred = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`bench server did not start:\n${stderr}`)), Number(env.BENCH_START_TIMEOUT_MS ?? 60_000));
    child.on("message", (m) => {
      if (m.type === "ready") { clearTimeout(t); res(m.cred); }
      if (m.type === "sample") samples.push(m);
    });
    child.on("exit", (code) => { clearTimeout(t); rej(new Error(`bench server exited ${code}:\n${stderr}`)); });
  });
  child.removeAllListeners("exit");
  return { child, cred, samples, stderr: () => stderr };
}

export function startMockCasino(env = {}) {
  const [cmd, argv] = pinned(process.execPath, [join(BENCH_DIR, "mock-casino.mjs")], 1);
  const child = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((res, rej) => {
    child.stdout.once("data", () => res(child));
    child.once("exit", (c) => rej(new Error(`mock casino exited ${c}`)));
  });
}

/** Signed operator launch → session init. Same HMAC scheme as src/lib/security/hmac.ts. */
export async function launchPlayer(cred, playerId) {
  const { computeSignature } = await importDist("lib/security/hmac.js");
  const base = `http://127.0.0.1:${cred.port}`;
  for (;;) {
    const body = JSON.stringify({ game_code: "bananax", operator_player_id: playerId, currency: "GEL", origin: "play.bench.test" });
    const ts = Math.floor(Date.now() / 1000).toString();
    const r = await request(`${base}/operator/v1/launch`, {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-api-key": cred.key, "x-timestamp": ts, "x-nonce": randomUUID(),
        "x-signature": computeSignature(cred.secret, { timestamp: ts, method: "POST", path: "/operator/v1/launch", rawBody: body }) }
    });
    if (r.status === 429) { await sleep(1000); continue; } // operator rate limit (600/min)
    const j = r.json;
    if (!j.launch_token) throw new Error(`launch ${r.status} ${JSON.stringify(j)}`);
    return j.launch_token;
  }
}

export async function openSession(cred, launchToken) {
  const r = await request(`http://127.0.0.1:${cred.port}/game/v1/session/init`, { method: "POST", headers: { authorization: `Bearer ${launchToken}` } });
  const j = r.json;
  if (!j.session_token) throw new Error(`session init ${r.status} ${JSON.stringify(j)}`);
  return j.session_token;
}

/**
 * Bench Postgres safety: the suite DROPS AND RECREATES the public schema, so it only
 * accepts BENCH_DATABASE_URL and only when the database name contains "bench".
 */
export function benchDbUrl() {
  const url = process.env.BENCH_DATABASE_URL;
  if (!url) return null;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/bench/i.test(name)) {
    console.error(`Refusing BENCH_DATABASE_URL: database name "${name}" must contain "bench" (the suite wipes it).`);
    process.exit(2);
  }
  return url;
}

export async function resetBenchDb(url) {
  const { Client } = requirePlatform("pg");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await c.end();
}

export async function queryBenchDb(url, sql) {
  const { Client } = requirePlatform("pg");
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(sql)).rows; } finally { await c.end(); }
}
