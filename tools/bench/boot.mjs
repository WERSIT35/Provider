// Boot time against a large ledger (Phase 2 gate: 1M rounds, boot < 10 s).
//
//   node tools/bench/boot.mjs --seed 1000000 [--players 300]   wipe the bench DB, fill it with N real rounds
//   node tools/bench/boot.mjs [--runs 3]                         time restarts against what is there
//
// Seeding plays real rounds through the real API (signed launch, session, spin):
// every row is chained, signed and written through, exactly as in production. A boot
// is timed from process spawn to "listening" (migrations + hydrate included), then one
// spin proves the restarted server serves and continues the chain. Needs
// BENCH_DATABASE_URL. Writes qa/bench/boot.json.
import { randomUUID } from "node:crypto";
import { args, benchDbUrl, launchPlayer, openSession, queryBenchDb, request, resetBenchDb, sleep, startServer, writeResult, pinGeneratorSide } from "./common.mjs";

pinGeneratorSide();
const a = args({ seed: 0, players: 300, runs: 3 });
const db = benchDbUrl();
if (!db) { console.error("boot needs BENCH_DATABASE_URL (see tools/bench/README.md)"); process.exit(2); }
const count = async (table) => Number((await queryBenchDb(db, `SELECT count(*)::bigint AS n FROM ${table}`))[0].n);

if (a.seed > 0) {
  await resetBenchDb(db);
  const srv = await startServer({ DATABASE_URL: db });
  const base = `http://127.0.0.1:${srv.cred.port}`;
  try {
    const session = async (n) => openSession(srv.cred, await launchPlayer(srv.cred, `p${n}`));
    const tokens = [];
    for (let i = 0; i < a.players; i += 20) {
      const batch = Array.from({ length: Math.min(20, a.players - i) }, (_, k) => i + k);
      tokens.push(...(await Promise.all(batch.map(session))));
    }
    let ok = 0; const errors = {}; const t0 = Date.now(); let lastLog = t0;
    const player = async (tok, n) => {
      while (ok < a.seed) {
        const r = await request(`${base}/game/v1/spin`, { method: "POST", body: '{"bet_amount":1}',
          headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": randomUUID() } }).catch((e) => ({ status: 0, json: { error: { code: e.message } } }));
        if (r.status === 200) ok++;
        else {
          const code = r.json?.error?.code;
          errors[`${r.status}:${code}`] = (errors[`${r.status}:${code}`] ?? 0) + 1;
          if (code === "REALITY_CHECK_REQUIRED") await request(`${base}/game/v1/reality-check/ack`, { method: "POST", headers: { authorization: `Bearer ${tok}` } });
          else if (r.status === 401) tok = await session(n); // session expired over a long seed
          else await sleep(200);
        }
        if (Date.now() - lastLog > 30_000) {
          lastLog = Date.now();
          console.log(`${ok.toLocaleString()} rounds, ${(ok / ((Date.now() - t0) / 1000)).toFixed(0)}/s, rss ${(srv.samples.at(-1)?.rss / 1048576).toFixed(0)} MB`);
        }
      }
    };
    await Promise.all(tokens.map(player));
    console.log(`seeded ${ok.toLocaleString()} rounds in ${((Date.now() - t0) / 60000).toFixed(1)} min; errors ${JSON.stringify(errors)}`);
  } finally {
    srv.child.kill();
    await sleep(1000);
  }
}

const rounds = await count("rounds");
const txs = await count("wallet_transactions");
const audits = await count("audit_records");
const boots = [];
for (let i = 0; i < a.runs; i++) {
  const t0 = performance.now();
  const srv = await startServer({ DATABASE_URL: db, BENCH_RESUME: "1", BENCH_START_TIMEOUT_MS: "600000" });
  const bootMs = Math.round(performance.now() - t0);
  try {
    await sleep(2500); // one RSS sample after boot
    const rss = srv.samples.at(-1)?.rss ?? null;
    const tok = await openSession(srv.cred, await launchPlayer(srv.cred, `boot${i}`));
    const r = await request(`http://127.0.0.1:${srv.cred.port}/game/v1/spin`, { method: "POST", body: '{"bet_amount":1}',
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": randomUUID() } });
    boots.push({ bootMs, rssMB: rss ? Math.round(rss / 1048576) : null, firstSpin: r.status });
    console.log(`boot ${i + 1}: ${bootMs} ms, rss ${rss ? Math.round(rss / 1048576) : "?"} MB, first spin ${r.status}`);
  } finally {
    srv.child.kill();
    await sleep(1000);
  }
}
const result = { rounds, walletTransactions: txs, auditRecords: audits, boots, bootMsMax: Math.max(...boots.map((b) => b.bootMs)), pass: boots.every((b) => b.bootMs < 10_000 && b.firstSpin === 200) };
console.log(result);
console.log("→", writeResult("boot", result));
process.exit(result.pass ? 0 : 1);
