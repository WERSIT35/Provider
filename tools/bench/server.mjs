// Bench server: the real platform app from platform/dist, seeded with one operator
// and Vault 20K. Started by the other bench scripts over IPC (common.mjs startServer).
//
// Env:
//   BENCH_PORT          listen port (default 8090)
//   BENCH_WALLET        sandbox (default) | webhook (calls tools/bench/mock-casino.mjs)
//   BENCH_CASINO_URL    webhook base URL (default http://127.0.0.1:8091/wallet)
//   DATABASE_URL        Postgres write-through, same code path as src/server.ts
//   BENCH_RESUME=1      boot like a restart: hydrate from Postgres, do not seed
//   BENCH_KEY_FILE      Ed25519 signing key (PEM), created on first use and reused across restarts
//   BENCH_RECON_MS      debit reconciler interval (default: the app's 30 s)
//   LOG_LEVEL           default info (production level); logs go to /dev/null
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importDist } from "./common.mjs";

const { buildContainer } = await importDist("container.js");
const { buildApp } = await importDist("app.js");
const { createLogger } = await importDist("lib/logger.js");
const { SandboxWallet } = await importDist("modules/wallet/sandbox-wallet.js");
const { WebhookWallet } = await importDist("modules/wallet/webhook-wallet.js");

const PORT = Number(process.env.BENCH_PORT ?? 8090);
const WALLET = process.env.BENCH_WALLET ?? "sandbox";
const RESUME = process.env.BENCH_RESUME === "1";
const DB = process.env.DATABASE_URL;
const KEY_FILE = process.env.BENCH_KEY_FILE ?? join(tmpdir(), "vault20k-bench-signing-key.pem");
const CRED_FILE = join(tmpdir(), `vault20k-bench-cred-${PORT}.json`);

if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
const pem = readFileSync(KEY_FILE, "utf8");

let persistence;
if (DB) {
  const { createPool } = await importDist("db/pool.js");
  const { runMigrations } = await importDist("db/migrate.js");
  const { PostgresPersistence } = await importDist("persistence/persistence.js");
  const pool = createPool(DB);
  await runMigrations(pool);
  persistence = new PostgresPersistence(pool);
}

const sandbox = new SandboxWallet();
const container = buildContainer(
  {
    launchSecret: "bench-launch-secret-0123456789abcdef", sessionSecret: "bench-session-secret-0123456789abcd",
    adminSecret: "bench-admin-secret-0123456789abcdef", hmacSkewSeconds: 30, rateLimitPerMin: 600,
    exportSigningKey: pem
  },
  WALLET === "webhook" ? { walletFactory: (m) => new WebhookWallet(m), persistence } : { wallet: sandbox, persistence }
);
const app = buildApp({
  logger: createLogger({ level: process.env.LOG_LEVEL ?? "info", pretty: false, env: "staging" }),
  container,
  debitReconcileIntervalMs: process.env.BENCH_RECON_MS ? Number(process.env.BENCH_RECON_MS) : undefined
});

// Same boot order as src/server.ts: hydrate before serving.
if (DB) {
  const { hydrateContainer } = await importDist("persistence/hydrate.js");
  await hydrateContainer(container, persistence);
}

let cred;
if (RESUME) {
  cred = JSON.parse(readFileSync(CRED_FILE, "utf8"));
  // A database seeded through the sandbox wallet, booted as production (casino wallet):
  // point the bench operator at the mock casino.
  if (WALLET === "webhook") {
    const op = container.mgmt.listOperators().find((o) => o.slug === "bench");
    if (op && !container.mgmt.getWebhookConfig(op.id)) {
      container.mgmt.setWebhook(op.id, process.env.BENCH_CASINO_URL ?? "http://127.0.0.1:8091/wallet");
      if (persistence) await persistence.flush();
    }
  }
} else {
  const op = container.mgmt.createOperator({ name: "Bench Casino", slug: "bench", default_currency: "GEL" });
  container.mgmt.setOperatorStatus(op.id, "live");
  container.mgmt.addDomain(op.id, "play.bench.test", "prod");
  const c = container.mgmt.issueCredential(op.id, "prod", ["127.0.0.1/32"]);
  const game = container.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let mc = container.mgmt.createMathConfig({
    game_id: game.id, version: container.engine.rulesVersion(), rtp_profile_key: "bananax",
    theoretical_rtp: 96.38, config_hash: `sha256:${container.engine.rulesHash()}`
  });
  mc = container.mgmt.approveMathConfig(container.mgmt.submitMathConfigForReview(mc.id).id, "bench");
  container.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: mc.id, currency: "GEL", allowed_bets: [1, 5, 10, 50, 500] });
  if (WALLET === "webhook") container.mgmt.setWebhook(op.id, process.env.BENCH_CASINO_URL ?? "http://127.0.0.1:8091/wallet");
  cred = { key: c.credential.api_key_id, secret: c.api_secret, port: PORT };
  writeFileSync(CRED_FILE, JSON.stringify(cred));
  // Seeding runs outside a request, so nothing else would flush it.
  if (persistence) await persistence.flush();
}

// Sandbox players get funds lazily: any p<N> id launched by the bench.
if (WALLET !== "webhook") {
  const orig = sandbox.balance.bind(sandbox);
  const funded = new Set();
  const fund = (id, cur) => { if (!funded.has(id)) { funded.add(id); sandbox.setBalance(id, cur, 1e9); } };
  sandbox.balance = async (ctx, a) => { fund(a.operatorPlayerId, a.currency); return orig(ctx, a); };
  const debit = sandbox.debit.bind(sandbox);
  sandbox.debit = async (ctx, a) => { fund(a.operatorPlayerId, a.currency); return debit(ctx, a); };
}

await app.listen({ host: "127.0.0.1", port: PORT });

// Event-loop delay: how long a ready callback waited for the main thread (GC pauses,
// long synchronous work). Latency tails that are not in the database live here.
const { monitorEventLoopDelay } = await import("node:perf_hooks");
const eld = monitorEventLoopDelay({ resolution: 5 });
eld.enable();
const { PerformanceObserver } = await import("node:perf_hooks");
let gcMax = 0; let gcTotal = 0; const gcKinds = {};
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gcMax = Math.max(gcMax, e.duration); gcTotal += e.duration;
    const k = { 1: "minor", 2: "major", 4: "incremental", 8: "weak" }[e.detail?.kind] ?? "other";
    gcKinds[k] = Math.max(gcKinds[k] ?? 0, e.duration);
  }
}).observe({ entryTypes: ["gc"] });
let lastCpu = process.cpuUsage(); let lastT = performance.now();
setInterval(() => {
  const cpu = process.cpuUsage(lastCpu); const t = performance.now();
  process.send?.({ type: "sample", rss: process.memoryUsage().rss, cpuPct: +(((cpu.user + cpu.system) / 1000) / (t - lastT) * 100).toFixed(1),
    loopDelayP99Ms: +(eld.percentile(99) / 1e6).toFixed(1), loopDelayMaxMs: +(eld.max / 1e6).toFixed(1),
    gcMaxMs: +gcMax.toFixed(1), gcPct: +((gcTotal / (t - lastT)) * 100).toFixed(1), gcMaxByKind: { ...gcKinds } });
  eld.reset(); gcMax = 0; gcTotal = 0; for (const k of Object.keys(gcKinds)) delete gcKinds[k];
  lastCpu = process.cpuUsage(); lastT = t;
}, 2000).unref();
process.send?.({ type: "ready", cred });
process.on("disconnect", () => process.exit(0));
// A normal exit on SIGTERM, so --cpu-prof (BENCH_NODE_ARGS) writes its profile.
process.on("SIGTERM", () => process.exit(0));
