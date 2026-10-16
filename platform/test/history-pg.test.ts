/**
 * Phase 2 against a REAL Postgres (skipped unless TEST_DATABASE_URL is set; CI sets it).
 * The database's public schema is wiped, so its name must contain "test" or "bench".
 *
 * A platform with a deliberately tiny memory window plays rounds; then every history
 * read (SQL) must equal the same report recomputed in memory over ALL rows, a restart
 * must continue the chain from its tip, the full integrity sweep must pass, an old round
 * (outside the window) must still verify and export, and an old idempotency key must
 * still be refused.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createPool, closePool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";
import { PostgresPersistence } from "../src/persistence/persistence";
import { hydrateContainer } from "../src/persistence/hydrate";
import { buildContainer, type Container } from "../src/container";
import { buildApp } from "../src/app";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { InMemoryRoundRepository } from "../src/modules/ledger/memory-repositories";
import { InMemoryTransactionStore, type TxRecord } from "../src/modules/wallet/transaction-store";
import { InMemoryRoundAdjustmentStore, type AdjustmentRecord } from "../src/modules/rounds/round-adjustment.store";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import type { RoundRecord } from "../src/modules/ledger/ledger.types";

const URL_ = process.env.TEST_DATABASE_URL;
const dbName = URL_ ? new URL(URL_).pathname.slice(1) : "";
const run = Boolean(URL_) && /test|bench/i.test(dbName);
const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const WINDOW = { rounds: 30, coldRounds: 20, audit: 30, transactions: 90, coldTransactions: 60 };
const KEY = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe.skipIf(!run)("history from Postgres (bounded memory)", () => {
  let pool: ReturnType<typeof createPool>;
  let persistence: PostgresPersistence;
  let c: Container;
  let app: FastifyInstance;
  let opId: string;
  const keys: string[] = [];
  const tokens: Record<string, string> = {};

  async function boot(resume: boolean) {
    persistence = new PostgresPersistence(pool);
    const wallet = new SandboxWallet();
    c = buildContainer({ ...CONFIG, exportSigningKey: KEY }, { wallet, persistence, historyWindow: WINDOW });
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0, integritySweepIntervalMs: 0 });
    if (resume) await hydrateContainer(c, persistence);
    await app.ready();
    return wallet;
  }

  const sessionFor = async (player: string) => {
    const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
    return (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json().session_token as string;
  };
  const spin = (tok: string, key: string) =>
    app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": key }, payload: '{"bet_amount":1}' });

  beforeAll(async () => {
    pool = createPool(URL_!);
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await runMigrations(pool);
    const wallet = await boot(false);
    const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
    let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
    cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
    const op = c.mgmt.createOperator({ name: "A", slug: "a" });
    opId = op.id;
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
    for (const p of ["p1", "p2", "p3"]) wallet.setBalance(p, "GEL", 100_000);
    await persistence.flush();
    for (const p of ["p1", "p2", "p3"]) {
      const tok = await sessionFor(p);
      tokens[p] = tok;
      for (let i = 0; i < 60; i++) {
        const k = randomUUID();
        const res = await spin(tok, k);
        expect(res.statusCode, res.body).toBe(200);
        keys.push(k);
      }
    }
    // Void one OLD round (outside the window) the way the admin route does.
    await c.history.ensureRound(`r_${keys[2]}`);
    await c.lifecycle.voidRound(`r_${keys[2]}`, "ops", "test void");
    await persistence.flush();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
  });

  /** The same reports, recomputed in memory over EVERY row in the database. */
  async function reference() {
    const rounds = new InMemoryRoundRepository();
    rounds.hydrate((await persistence.loadRows("rounds")) as unknown as RoundRecord[]);
    const txs = new InMemoryTransactionStore();
    txs.hydrate((await persistence.loadRows("wallet_transactions")) as unknown as TxRecord[]);
    const adj = new InMemoryRoundAdjustmentStore();
    adj.hydrate((await persistence.loadRows("round_adjustments")) as unknown as AdjustmentRecord[]);
    return new ReportingService(rounds, txs, c.engine, adj);
  }

  it("memory held a window, not the history", () => {
    expect(c.roundsRepo.size()).toBe(180);
    expect(c.roundsRepo.heldCount()).toBeLessThanOrEqual(WINDOW.rounds * 1.25 + WINDOW.coldRounds);
  });

  it("every report from SQL equals the full in-memory recomputation", async () => {
    const ref = await reference();
    expect(await c.history.roundsSummary(opId)).toEqual(ref.roundsSummary(opId));
    expect(await c.history.rtpReport(opId)).toEqual(ref.rtpReport(opId));
    expect(await c.history.ggrByDay(opId)).toEqual(ref.ggrByDay(opId));
    expect(await c.history.reconcile(opId)).toEqual(ref.reconcile(opId));
    expect((await c.history.playerReport(opId, { sort: "total_bet" })).players).toEqual(ref.playerReport(opId, { sort: "total_bet" }).players);
    expect(await c.history.playerSummary(opId, "p1")).toEqual(ref.playerSummary(opId, "p1"));
    const page = await c.history.playerRounds(opId, "p2", 10);
    expect(page.total).toBe(60);
    expect(page.rounds.map((r) => r.round_ref)).toEqual(ref.listRoundsByPlayer(opId, "p2").slice(0, 10).map((r) => r.round_ref));
    expect(page.currencies[page.rounds[0].session_id]).toBe("GEL");
    expect((await c.history.roundsSummary(opId)).rounds).toBe(179); // the voided round is excluded
  });

  it("after a restart: the chain continues from its tip, the sweep passes, old rounds verify and export, old keys stay refused", async () => {
    await app.close();
    await boot(true);
    expect(c.roundsRepo.heldCount()).toBeLessThanOrEqual(WINDOW.rounds);
    c.mgmt.getOperator(opId); // small tables are fully loaded
    const tok = await sessionFor("p1");
    const res = await spin(tok, randomUUID());
    expect(res.statusCode, res.body).toBe(200);
    expect(c.ledger.getRound(res.json().round_ref)!.seq).toBe(180);

    const integrity = await c.history.verifyIntegrity();
    expect(integrity.rounds).toMatchObject({ ok: true, length: 181 });
    expect(integrity.audit.ok).toBe(true);
    expect(integrity.signatures?.rounds).toMatchObject({ ok: true, valid: 181 });

    const old = `r_${keys[5]}`;
    expect(c.ledger.getRound(old)).toBeNull(); // not in memory…
    expect(await c.history.ensureRound(old)).toBe(true); // …until a view asks for it
    expect(c.verification.verify(old)).toMatchObject({ verdict: "legitimate", chain_ok: true });
    const exported = c.roundExport.export(old, opId);
    expect(exported).toBeTruthy();

    // An old key (its outcome long gone from memory) is still single-use.
    const replay = await spin(tok, keys[7]);
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("after a restart a session's reality-check totals cover ALL its rounds, loaded on its first request", async () => {
    // p3's session survived the restart above; its 60 rounds are mostly outside the window.
    const sessionId = (await persistence.loadRows("rounds", { where: "operator_player_id = $1", params: ["p3"], limit: 1 }))[0].session_id as string;
    expect(c.roundsRepo.statsArePending(sessionId)).toBe(true); // boot did not aggregate it
    const status = await app.inject({ method: "GET", url: "/game/v1/reality-check", headers: { authorization: `Bearer ${tokens.p3}` } });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().stats).toMatchObject({ rounds: 60, wagered: 60 });
    expect(c.roundsRepo.statsArePending(sessionId)).toBe(false);
    const res = await spin(tokens.p3, randomUUID());
    expect(res.statusCode, res.body).toBe(200);
    expect(c.roundsRepo.sessionStats(sessionId).rounds).toBe(61);
  });

  it("a session evicted from memory while its token is still valid comes back on its next request", async () => {
    // A bonus resumed after an hour keeps the session's old created_at, and the token
    // issued at the resume outlives the age-based eviction (seen in the 2 h soak).
    const sessionId = (await persistence.loadRows("rounds", { where: "operator_player_id = $1", params: ["p3"], limit: 1 }))[0].session_id as string;
    expect(c.sessions.evictIdle(Date.now() + 2 * 3600_000)).toContain(sessionId);
    expect(c.sessions.has(sessionId)).toBe(false);
    const status = await app.inject({ method: "GET", url: "/game/v1/reality-check", headers: { authorization: `Bearer ${tokens.p3}` } });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().stats).toMatchObject({ rounds: 61 });
    const res = await spin(tokens.p3, randomUUID());
    expect(res.statusCode, res.body).toBe(200);
  });
});
