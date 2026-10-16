// Crash-safety gate: kill -9 the platform mid-load, restart it, let the debit
// reconciler sweep, then compare the mock casino's own ledger with ours.
//
//   BENCH_DATABASE_URL=postgres://…/vault20k_bench node tools/bench/chaos.mjs [--players 200] [--kills 3] [--interval 18]
//
// Exits 1 if any acknowledged round is missing, any casino debit has neither a round
// nor a rollback, or anything is duplicated. Writes qa/bench/chaos.json.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  args, benchDbUrl, launchPlayer, openSession, queryBenchDb, resetBenchDb, sleep, startMockCasino, startServer, writeResult, request, pinGeneratorSide
} from "./common.mjs";
pinGeneratorSide();

const a = args({ players: 200, kills: 3, interval: 18, "think-min": 200, "think-max": 600, settle: 45 });
const db = benchDbUrl();
if (!db) { console.error("chaos needs BENCH_DATABASE_URL (see tools/bench/README.md)"); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), "vault20k-chaos-"));
const casinoLog = join(work, "casino-ledger.jsonl");
const keyFile = join(work, "signing-key.pem");
await resetBenchDb(db);
const casino = await startMockCasino({ CASINO_LOG: casinoLog });
// Never leave a server or casino behind if anything below throws.
let srvRef = null;
const cleanup = () => { try { srvRef?.child.kill("SIGKILL"); } catch {} try { casino.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); cleanup(); process.exit(1); });
const serverEnv = { BENCH_WALLET: "webhook", DATABASE_URL: db, BENCH_KEY_FILE: keyFile, BENCH_RECON_MS: "2000" };
let srv = await startServer(serverEnv);
srvRef = srv;
const cred = srv.cred;
const base = `http://127.0.0.1:${cred.port}`;

const tokens = [];
for (let i = 0; i < a.players; i += 20) {
  const ids = Array.from({ length: Math.min(20, a.players - i) }, (_, k) => `c${i + k}`);
  tokens.push(...(await Promise.all(ids.map(async (id) => openSession(cred, await launchPlayer(cred, id))))));
}

const acknowledged = []; let netErrors = 0; let running = true;
const think = () => a["think-min"] + Math.random() * (a["think-max"] - a["think-min"]);
const player = async (tok) => {
  while (running) {
    try {
      const r = await request(`${base}/game/v1/spin`, { method: "POST", body: '{"bet_amount":1}',
        headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": randomUUID() } });
      const j = r.json;
      if (r.status === 200) acknowledged.push(j.round_ref);
    } catch { netErrors++; }
    await sleep(think());
  }
};
const load = Promise.all(tokens.map(player));

const kills = [];
for (let k = 1; k <= a.kills; k++) {
  await sleep(a.interval * 1000);
  srv.child.kill("SIGKILL");
  kills.push({ at: new Date().toISOString(), acknowledgedSoFar: acknowledged.length });
  console.log(`kill -9 #${k} (${acknowledged.length} rounds acknowledged so far)`);
  await sleep(2000);
  srv = await startServer({ ...serverEnv, BENCH_RESUME: "1" });
  srvRef = srv;
}
await sleep(a.interval * 1000);
running = false;
await load;
console.log(`load stopped; ${a.settle}s for the debit reconciler`);
await sleep(a.settle * 1000);
srv.child.kill();
casino.kill();
await sleep(1000);

// ── Compare ledgers ─────────────────────────────────────────────────────────────
const dbRounds = await queryBenchDb(db, "select round_ref from rounds");
const dbCount = new Map();
for (const { round_ref } of dbRounds) dbCount.set(round_ref, (dbCount.get(round_ref) ?? 0) + 1);
// Money the casino actually APPLIED (a replayed idempotency key moves nothing).
const allCasinoRows = readFileSync(casinoLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const casinoRows = allCasinoRows.filter((e) => !e.replay);
const byRound = new Map();
const keyToRound = new Map();
const g = (r) => { if (!byRound.has(r)) byRound.set(r, { debitKeys: new Set(), credits: 0, rollbacks: 0 }); return byRound.get(r); };
for (const e of casinoRows) if (e.action === "debit") { g(e.roundRef).debitKeys.add(e.key); keyToRound.set(e.key, e.roundRef); }
for (const e of casinoRows) if (e.action === "credit") g(e.roundRef).credits++;
for (const e of casinoRows) if (e.action === "rollback") { const r = e.roundRef ?? keyToRound.get(e.orig); if (r) g(r).rollbacks++; }

let debitNoRoundNoRollback = 0, doubleDebited = 0, doubleCredited = 0;
for (const [ref, c] of byRound) {
  if (c.debitKeys.size > 1) doubleDebited++;
  if (c.credits > 1) doubleCredited++;
  if (c.debitKeys.size && !dbCount.has(ref) && !c.rollbacks) debitNoRoundNoRollback++;
}
const result = {
  config: { players: a.players, kills: a.kills, intervalS: a.interval, thinkMs: [a["think-min"], a["think-max"]], reconcilerMs: 2000 },
  kills,
  acknowledgedRounds: acknowledged.length,
  roundsInDb: dbRounds.length,
  lostAcknowledgedRounds: acknowledged.filter((r) => !dbCount.has(r)).length,
  duplicateRoundRefsInDb: [...dbCount.values()].filter((n) => n > 1).length,
  duplicateAcknowledgements: acknowledged.length - new Set(acknowledged).size,
  casinoDebitedRounds: [...byRound.values()].filter((c) => c.debitKeys.size).length,
  debitsWithNoRoundAndNoRollback: debitNoRoundNoRollback,
  doubleDebitedRounds: doubleDebited,
  doubleCreditedRounds: doubleCredited,
  casinoReplaysAnswered: allCasinoRows.length - casinoRows.length,
  clientNetworkErrors: netErrors
};
const failures = ["lostAcknowledgedRounds", "duplicateRoundRefsInDb", "duplicateAcknowledgements", "debitsWithNoRoundAndNoRollback", "doubleDebitedRounds", "doubleCreditedRounds"]
  .filter((k) => result[k] > 0);
result.pass = failures.length === 0;
result.failures = failures;
console.log(JSON.stringify(result, null, 2));
console.log("→", writeResult("chaos", result));
process.exit(result.pass ? 0 : 1);
