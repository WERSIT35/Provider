/**
 * Phase 2 — bounded memory. Unit level (no database): the windowed stores keep the
 * same semantics as the full in-memory ones while holding a bounded number of rows.
 * Postgres level (only when TEST_DATABASE_URL is set; CI does): the windowed platform's
 * history reads match a full recomputation, and a restart continues the chain.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryTransactionStore, DEBIT_OUTCOME_UNKNOWN, type TxInput, type TxRecord, BET_TX_TYPES, WIN_TX_TYPES } from "../src/modules/wallet/transaction-store";
import { RateLimiter } from "../src/lib/security/rate-limiter";
import { buildContainer } from "../src/container";
import { buildApp } from "../src/app";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { IDEMPOTENCY_CACHE_MS, IDEMPOTENCY_CACHE_PER_SESSION } from "../src/modules/rounds/round-orchestrator";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };


describe("windowed money ledger: the operational queues match a full scan", () => {
  /** The original (full-scan) definitions from before Phase 2. */
  const reference = (rows: TxRecord[]) => {
    const reversed = new Set(rows.filter((t) => t.type === "ROLLBACK").map((t) => t.round_ref));
    const credited = new Set(rows.filter((t) => WIN_TX_TYPES.has(t.type) && t.status === "confirmed").map((t) => t.round_ref));
    return {
      pending: rows.filter((t) => BET_TX_TYPES.has(t.type) && t.status === "failed" && t.error_code === DEBIT_OUTCOME_UNKNOWN && !reversed.has(t.round_ref)).map((t) => t.idempotency_key),
      failed: rows.filter((t) => WIN_TX_TYPES.has(t.type) && t.status === "failed" && !credited.has(t.round_ref)).map((t) => t.idempotency_key)
    };
  };

  it("over 5,000 random money moves, with a window of 50", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const windowed = new InMemoryTransactionStore(undefined, { retain: 50 });
    const full = new InMemoryTransactionStore();
    for (let i = 0; i < 5000; i++) {
      const round = `r${Math.floor(rnd() * 400)}`;
      const k = rnd();
      const input: TxInput =
        k < 0.1 ? { operator_id: "op", session_id: "s", round_ref: round, type: "DEBIT", amount: 1, currency: "GEL", idempotency_key: `${round}:debit:${i}`, status: "failed", error_code: DEBIT_OUTCOME_UNKNOWN }
        : k < 0.2 ? { operator_id: "op", session_id: "s", round_ref: round, type: "ROLLBACK", amount: 1, currency: "GEL", idempotency_key: `${round}:rb:${i}`, status: "rolled_back" }
        : k < 0.3 ? { operator_id: "op", session_id: "s", round_ref: round, type: "CREDIT", amount: 2, currency: "GEL", idempotency_key: `${round}:cr:${i}`, status: "failed", error_code: "WALLET_CREDIT_FAILED" }
        : k < 0.35 ? { operator_id: "op", session_id: "s", round_ref: round, type: "CREDIT", amount: 2, currency: "GEL", idempotency_key: `${round}:ok:${i}`, status: "confirmed" }
        : { operator_id: "op", session_id: "s", round_ref: round, type: "DEBIT", amount: 1, currency: "GEL", idempotency_key: `${round}:d:${i}`, status: "confirmed" };
      windowed.record(input);
      full.record(input);
    }
    const ref = reference(full.list());
    expect(windowed.listPendingReversals().map((t) => t.idempotency_key).sort()).toEqual(ref.pending.sort());
    expect(windowed.listFailedSettlements().map((t) => t.idempotency_key).sort()).toEqual(ref.failed.sort());
    expect(windowed.heldCount()).toBeLessThanOrEqual(63);
    expect(windowed.size()).toBe(5000);
  });

  it("a row presented at boot both in the window and as a queue row is queued once", () => {
    const src = new InMemoryTransactionStore();
    src.record({ operator_id: "op", session_id: "s", round_ref: "r1", type: "DEBIT", amount: 1, currency: "GEL", idempotency_key: "r1:debit", status: "failed", error_code: DEBIT_OUTCOME_UNKNOWN });
    src.record({ operator_id: "op", session_id: "s", round_ref: "r2", type: "CREDIT", amount: 2, currency: "GEL", idempotency_key: "r2:credit", status: "failed", error_code: "WALLET_CREDIT_FAILED" });
    const rows = src.list();
    const booted = new InMemoryTransactionStore(undefined, { retain: 50 });
    booted.hydrate(rows, 2);
    booted.hydrateQueues(rows);
    expect(booted.listPendingReversals().map((t) => t.idempotency_key)).toEqual(["r1:debit"]);
    expect(booted.listFailedSettlements().map((t) => t.idempotency_key)).toEqual(["r2:credit"]);
  });
});

describe("caches with no end", () => {
  afterEach(() => vi.useRealTimers());

  it("the rate limiter forgets idle keys", () => {
    const rl = new RateLimiter(600);
    const t0 = 1_000_000;
    for (let i = 0; i < 10_000; i++) rl.allow(`sess:${i}`, t0);
    expect(rl.size()).toBeGreaterThan(5_000);
    for (let i = 0; i < 4096; i++) rl.allow("busy", t0 + 120_000); // the sweep runs every 4,096 calls
    expect(rl.size()).toBeLessThan(10);
  });

  it("sessions no token can reach are evicted; an unfinished bonus is kept", () => {
    const c = buildContainer(CONFIG, {});
    const s = c.sessions as unknown as { sessions: Map<string, { id: string; created_at: string; free_spins_left: number }> };
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    s.sessions.set("idle", { id: "idle", created_at: old, free_spins_left: 0 } as never);
    s.sessions.set("bonus", { id: "bonus", created_at: old, free_spins_left: 4 } as never);
    s.sessions.set("fresh", { id: "fresh", created_at: new Date().toISOString(), free_spins_left: 0 } as never);
    expect(c.sessions.evictIdle()).toEqual(["idle"]);
    expect(c.sessions.size()).toBe(2);
  });

  it("the idempotency cache drops outcomes older than the retry window; the key stays single-use", async () => {
    const wallet = new SandboxWallet();
    const c = buildContainer(CONFIG, { wallet });
    const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
    await app.ready();
    const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
    let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
    cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
    const op = c.mgmt.createOperator({ name: "A", slug: "a" });
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
    wallet.setBalance("p1", "GEL", 1_000);
    const lt = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
    const tok = (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json().session_token;
    const spin = (key: string) => app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": key }, payload: '{"bet_amount":1}' });

    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const first = randomUUID();
    expect((await spin(first)).statusCode).toBe(200);
    expect((await spin(first)).json().idempotent_replay).toBe(true); // cached
    vi.setSystemTime(Date.now() + IDEMPOTENCY_CACHE_MS + 60_000);
    expect((await spin(randomUUID())).statusCode).toBe(200); // evicts the old entry
    const again = await spin(first);
    expect(again.statusCode).toBe(409); // no longer cached, still single-use
    expect(again.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    const cache = (c.orchestrator as unknown as { idem: Map<string, unknown> }).idem;
    expect(cache.size).toBe(1);

    // Within the window, a session keeps only its latest few outcomes: the cache is
    // bounded by live sessions, not by spins per 15 minutes.
    const keys = Array.from({ length: 30 }, () => randomUUID());
    for (const k of keys) expect((await spin(k)).statusCode).toBe(200);
    expect(c.orchestrator.idemSize()).toBe(IDEMPOTENCY_CACHE_PER_SESSION);
    expect((await spin(keys[29])).json().idempotent_replay).toBe(true); // the latest replays
    expect((await spin(keys[0])).json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT"); // an old one stays single-use
  });
});
