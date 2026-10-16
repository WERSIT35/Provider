/**
 * Phase 1 — money safety (docs/perf-baseline.md "Critical defects" 1–3).
 *
 *  1. the casino's own wallet is used (RoutingWallet), never the provider sandbox in production;
 *  2. a restart can no longer poison the write queue (signing_keys upsert, quarantine);
 *  3. a success is only answered for durable state, flushes never overlap (no deadlocks),
 *     and a crash between the casino and our ledger is finished or unwound (intents).
 *
 * No real database (the suite never needs one): a fake pg Pool that behaves like the
 * parts of Postgres these paths depend on — the signing_keys trigger, SQLSTATE errors,
 * transactions and savepoints.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer, assertLiveOperatorsHaveWallets, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { PostgresPersistence, PersistenceError, type Persistence } from "../src/persistence/persistence";
import { runWithTrace, contextFrom } from "../src/lib/trace-context";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { RoutingWallet } from "../src/modules/wallet/routing-wallet";
import { WalletDeclinedError, type CreditArgs, type DebitArgs, type RollbackArgs, type WalletAdapter } from "../src/modules/wallet/wallet.types";
import { recoverRounds } from "../src/jobs/round-recovery";
import { DEBIT_OUTCOME_UNKNOWN } from "../src/modules/wallet/transaction-store";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const silent = () => createLogger({ level: "silent", pretty: false, env: "test" });

// ── A fake Postgres ─────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
class FakePg {
  /** Committed rows per table, keyed by primary key value. */
  readonly tables = new Map<string, Map<string, Row>>();
  /** Returns an error to throw for this statement, or null. */
  fail: (sql: string, values: unknown[]) => { code: string; message: string } | null = () => null;
  maxConcurrentTx = 0;
  private openTx = 0;
  readonly log: string[] = [];

  pool(): Pool {
    return { connect: async () => this.client(), query: async (sql: string) => this.select(sql) } as unknown as Pool;
  }

  private select(sql: string) {
    const table = /FROM\s+(\w+)/i.exec(sql)?.[1] ?? "";
    return { rows: [...(this.tables.get(table)?.values() ?? [])].map((r) => ({ ...r })) };
  }

  private client() {
    let staged: Array<{ table: string; key: string; row: Row }> = [];
    let savepoint = 0;
    const db = this;
    return {
      release() {},
      async query(sql: string, values: unknown[] = []) {
        if (sql === "BEGIN") { db.openTx++; db.maxConcurrentTx = Math.max(db.maxConcurrentTx, db.openTx); staged = []; return; }
        if (sql === "COMMIT") {
          for (const s of staged) { if (!db.tables.has(s.table)) db.tables.set(s.table, new Map()); db.tables.get(s.table)!.set(s.key, s.row); }
          db.openTx--; db.log.push(`commit ${staged.length}`); staged = []; return;
        }
        if (sql === "ROLLBACK") { db.openTx--; staged = []; return; }
        if (sql.startsWith("SAVEPOINT")) { savepoint = staged.length; return; }
        if (sql.startsWith("RELEASE")) return;
        if (sql.startsWith("ROLLBACK TO")) { staged = staged.slice(0, savepoint); return; }
        const m = /^INSERT INTO (\w+) \(([^)]+)\)/.exec(sql);
        if (!m) return;
        const injected = db.fail(sql, values);
        if (injected) throw Object.assign(new Error(injected.message), { code: injected.code });
        const cols = m[2].split(", ");
        const row: Row = Object.fromEntries(cols.map((c, i) => [c, values[i]]));
        const key = String(row.id ?? row.key_id ?? row.idempotency_key ?? row.balance_key ?? row.operator_id ?? randomUUID());
        // The signing_keys trigger (migration 0012): key material is write-once.
        if (m[1] === "signing_keys") {
          const prev = db.tables.get("signing_keys")?.get(key);
          const updates = /DO UPDATE SET (.*)$/.exec(sql)?.[1] ?? "";
          if (prev && /created_at = EXCLUDED|public_key_pem = EXCLUDED/.test(updates) && (prev.created_at !== row.created_at || prev.public_key_pem !== row.public_key_pem)) {
            throw Object.assign(new Error(`signing key material is write-once (key ${key})`), { code: "P0001" });
          }
        }
        // ON CONFLICT semantics: DO NOTHING keeps the stored row; DO UPDATE SET only
        // changes the listed columns (and only when the version guard allows it).
        const prev = staged.find((s) => s.table === m[1] && s.key === key)?.row ?? db.tables.get(m[1])?.get(key);
        if (prev) {
          if (/DO NOTHING/.test(sql)) return;
          const set = /DO UPDATE SET (.*?)(?: WHERE |$)/.exec(sql)?.[1] ?? "";
          const guard = /WHERE \w+\.(\w+) < EXCLUDED\.(\w+)/.exec(sql);
          if (guard && !(Number(prev[guard[1]]) < Number(row[guard[1]]))) return;
          const merged = { ...prev };
          for (const part of set.split(", ")) { const col = part.split(" = ")[0]; if (col) merged[col] = row[col]; }
          staged.push({ table: m[1], key, row: merged });
          return;
        }
        staged.push({ table: m[1], key, row });
      }
    };
  }
}

const inTrace = <T>(fn: () => T): T => runWithTrace(contextFrom(undefined), fn);

describe("write-through durability (PostgresPersistence)", () => {
  it("a signing key re-saved on every boot only updates its mutable columns", async () => {
    const pg = new FakePg();
    const p = new PostgresPersistence(pg.pool());
    const key = { key_id: "ed25519:aa", alg: "Ed25519", public_key_pem: "PEM", status: "active", created_at: "2026-01-01T00:00:00.000Z", retired_at: null, expires_at: null };
    p.save("signing_keys", key);
    await p.flush();
    // Boot #2: the keyring re-saves the same key with a NEW created_at before hydrate.
    p.save("signing_keys", { ...key, created_at: "2026-10-16T00:00:00.000Z" });
    await expect(p.flush()).resolves.toBeUndefined();
    expect(pg.tables.get("signing_keys")!.get("ed25519:aa")!.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a row Postgres refuses for good is quarantined: its owner hears about it, the rest of the batch commits, later writes flow", async () => {
    const pg = new FakePg();
    const quarantined: string[] = [];
    const p = new PostgresPersistence(pg.pool(), { onQuarantine: (q) => quarantined.push(`${q.table}:${q.code}`) });
    pg.fail = (sql, values) => (sql.startsWith("INSERT INTO disputes") && values[0] === "bad" ? { code: "23514", message: "check violation" } : null);
    const a = inTrace(() => { p.save("disputes", { id: "bad" }); return p.flush(); });
    const b = inTrace(() => { p.save("disputes", { id: "good" }); return p.flush(); });
    await expect(a).rejects.toMatchObject({ kind: "permanent" });
    await expect(b).resolves.toBeUndefined();
    expect([...pg.tables.get("disputes")!.keys()]).toEqual(["good"]);
    expect(quarantined).toEqual(["disputes:23514"]);
    expect(p.quarantined).toHaveLength(1);
    // The poison is gone: the next write is unaffected.
    pg.fail = () => null;
    await inTrace(() => { p.save("disputes", { id: "next" }); return p.flush(); });
    expect(pg.tables.get("disputes")!.has("next")).toBe(true);
  });

  it("a transient failure (deadlock, lost connection) re-queues: the owner is told, the next flush commits it, no stale error", async () => {
    const pg = new FakePg();
    const p = new PostgresPersistence(pg.pool());
    let failures = 1;
    pg.fail = () => (failures-- > 0 ? { code: "40P01", message: "deadlock detected" } : null);
    const ctx = contextFrom(undefined);
    await expect(runWithTrace(ctx, () => { p.save("disputes", { id: "d1" }); return p.flush(); })).rejects.toBeInstanceOf(PersistenceError);
    expect(pg.tables.get("disputes")).toBeUndefined();
    await expect(runWithTrace(ctx, () => p.flush())).resolves.toBeUndefined(); // retried and committed
    expect(pg.tables.get("disputes")!.has("d1")).toBe(true);
  });

  it("flushes never overlap: concurrent requests group-commit through one transaction at a time", async () => {
    const pg = new FakePg();
    const p = new PostgresPersistence(pg.pool());
    await Promise.all(Array.from({ length: 25 }, (_, i) => inTrace(() => { p.save("disputes", { id: `d${i}` }); return p.flush(); })));
    expect(pg.maxConcurrentTx).toBe(1);
    expect(pg.tables.get("disputes")!.size).toBe(25);
    expect(pg.log.length).toBeLessThan(25); // grouped
  });
});

// ── The platform with a persistence that can fail on demand ───────────────────────────
class SwitchablePersistence implements Persistence {
  down = false;
  readonly saved: Array<{ table: string; row: Row }> = [];
  readonly events: string[] = [];
  save(table: string, row: object): void { this.saved.push({ table, row: { ...(row as Row) } }); }
  async flush(): Promise<void> {
    this.events.push(this.down ? "flush:failed" : "flush");
    if (this.down) throw new PersistenceError("PERSISTENCE_UNAVAILABLE", "transient");
  }
  async loadTable(): Promise<Row[]> { return []; }
  rows(table: string) { return this.saved.filter((s) => s.table === table).map((s) => s.row); }
}

/** A casino wallet that records the order of calls into a shared event log. */
function casino(events: string[], opts: { creditDown?: () => boolean } = {}) {
  const inner = new SandboxWallet();
  const w: WalletAdapter & { inner: SandboxWallet; credits: CreditArgs[]; rollbacks: RollbackArgs[] } = {
    inner, credits: [], rollbacks: [],
    balance: (ctx, a) => inner.balance(ctx, a),
    debit: (ctx, a: DebitArgs) => { events.push("debit"); return inner.debit(ctx, a); },
    credit: (ctx, a: CreditArgs) => { events.push("credit"); w.credits.push(a); if (opts.creditDown?.()) return Promise.reject(new Error("WEBHOOK_CALL_FAILED")); return inner.credit(ctx, a); },
    rollback: (ctx, a: RollbackArgs) => { events.push("rollback"); w.rollbacks.push(a); return inner.rollback(ctx, a); }
  };
  return w;
}

let app: FastifyInstance;
let c: Container;
let persistence: SwitchablePersistence;
let wallet: ReturnType<typeof casino>;
let opId: string;
let creditDown = false;

async function platform() {
  persistence = new SwitchablePersistence();
  creditDown = false;
  wallet = casino(persistence.events, { creditDown: () => creditDown });
  c = buildContainer(CONFIG, { wallet, persistence, debitRetryDelaysMs: [0, 0] });
  app = buildApp({ logger: silent(), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 10] });
  wallet.inner.setBalance("p1", "GEL", 1_000_000);
}
async function token(): Promise<string> {
  const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  return (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json().session_token;
}
const spin = (tok: string, idem: string) =>
  app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": idem }, payload: JSON.stringify({ bet_amount: 1 }) });

/** Spin until a round wins (and, when `win`, until it wins something). */
async function spinUntil(tok: string, want: (body: { total_win: number }) => boolean): Promise<{ idem: string; body: { total_win: number; round_ref: string } }> {
  for (let i = 0; i < 400; i++) {
    const idem = randomUUID();
    const res = await spin(tok, idem);
    expect(res.statusCode, res.body).toBe(200);
    if (want(res.json())) return { idem, body: res.json() };
  }
  throw new Error("no such round in 400 spins");
}

describe("a success is only answered for durable state", () => {
  beforeEach(platform);

  it("the intent is committed BEFORE the casino is asked for the stake, and a winning round BEFORE it is paid", async () => {
    const tok = await token();
    persistence.events.length = 0;
    await spinUntil(tok, (b) => b.total_win > 0);
    const ev = persistence.events.slice(-6).join(" ");
    // last round: flush(intent) → debit → flush(round) → credit → flush(response)
    expect(ev).toMatch(/flush debit flush credit flush$/);
    const intents = persistence.rows("round_intents");
    expect(intents.at(-1)).toMatchObject({ status: "settled" });
    expect(intents.some((r) => r.status === "committed")).toBe(true);
    expect(c.intents.size()).toBe(0);
  });

  it("database down: no stake is taken, and the client gets a retryable 503 — never a 200", async () => {
    const tok = await token();
    persistence.down = true;
    persistence.events.length = 0;
    const res = await spin(tok, randomUUID());
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("PERSISTENCE_UNAVAILABLE");
    expect(persistence.events).not.toContain("debit");
    expect(res.headers["retry-after"]).toBe("1");
  });

  it("database down after the stake was taken: no 200 on either path (win: before the credit; no win: at the response)", async () => {
    const tok = await token();
    for (let i = 0; i < 12; i++) {
      persistence.down = false;
      persistence.events.length = 0;
      const flush = SwitchablePersistence.prototype.flush.bind(persistence);
      persistence.flush = async () => { if (persistence.events.includes("debit")) persistence.down = true; return flush(); };
      const res = await spin(tok, randomUUID());
      expect(res.statusCode, res.body).toBe(503);
      expect(res.json().error).toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
      expect(persistence.events).not.toContain("credit"); // a win is never paid for a round that is not durable
    }
  });
});

describe("crash recovery (round intents)", () => {
  beforeEach(platform);

  const recover = () =>
    recoverRounds({
      intents: c.intents, ledger: c.ledger, transactions: c.transactions, debits: c.debits, wallet, persistence,
      isInFlight: (k) => c.orchestrator.isInFlight(k), logger: silent() as never, minAgeMs: 0
    });

  it("an OPEN intent whose round never committed: the stake is reversed by the debit's key, once", async () => {
    // What a process that died right after its debit leaves behind.
    c.intents.open({ idempotency_key: "dead", round_ref: "r_dead", operator_id: opId, session_id: "s", operator_player_id: "p1", currency: "GEL", debit_type: "DEBIT", debit_amount: 5, campaign_id: null, game_code: "bananax", round_type: "paid" });
    await wallet.debit({ operatorId: opId }, { idempotencyKey: "dead:debit", roundRef: "r_dead", operatorPlayerId: "p1", amount: 5, currency: "GEL" });
    const before = (await wallet.balance({ operatorId: opId }, { operatorPlayerId: "p1", currency: "GEL" })).amount;
    const r = await recover();
    expect(r).toMatchObject({ reversed: 1, credited: 0 });
    expect(wallet.rollbacks).toHaveLength(1);
    expect(wallet.rollbacks[0]).toMatchObject({ originalIdempotencyKey: "dead:debit", amount: 5 });
    expect((await wallet.balance({ operatorId: opId }, { operatorPlayerId: "p1", currency: "GEL" })).amount).toBeCloseTo(before + 5, 2);
    expect(c.transactions.getByKey("dead:debit")).toMatchObject({ status: "failed", error_code: DEBIT_OUTCOME_UNKNOWN });
    expect(c.intents.size()).toBe(0);
    expect((await recover()).reversed).toBe(0); // idempotent
    expect(wallet.rollbacks).toHaveLength(1);
  });

  it("a COMMITTED win the casino never confirmed is credited under its ORIGINAL credit key", async () => {
    const tok = await token();
    creditDown = true; // the round commits, then the credit is lost
    const { idem, body } = await spinUntil(tok, (b) => b.total_win > 0);
    // A failed credit in-process goes to the settlement queue (unchanged behaviour)…
    expect(c.transactions.getByKey(`${idem}:credit`)).toMatchObject({ status: "failed" });
    // …but a process that died before even recording it leaves a committed intent:
    c.intents.commit("crashed", { idempotency_key: "crashed", round_ref: body.round_ref, operator_id: opId, session_id: "s", operator_player_id: "p1", currency: "GEL", debit_type: "DEBIT", debit_amount: 1, campaign_id: null, game_code: "bananax", round_type: "paid" }, { credit_type: "CREDIT", win_amount: 7, feature_ref: null, round_type: "paid" });
    creditDown = false;
    const r = await recover();
    expect(r.credited).toBe(1);
    expect(wallet.credits.at(-1)).toMatchObject({ idempotencyKey: "crashed:credit", amount: 7 });
    expect(c.transactions.getByKey("crashed:credit")).toMatchObject({ status: "confirmed" });
    expect((await recover()).credited).toBe(0);
  });

  it("leaves a round that is still in flight alone", async () => {
    c.intents.open({ idempotency_key: "young", round_ref: "r_young", operator_id: opId, session_id: "s", operator_player_id: "p1", currency: "GEL", debit_type: "DEBIT", debit_amount: 1, campaign_id: null, game_code: "bananax", round_type: "paid" });
    const r = await recoverRounds({ intents: c.intents, ledger: c.ledger, transactions: c.transactions, debits: c.debits, wallet, persistence, isInFlight: () => true, logger: silent() as never, minAgeMs: 0 });
    expect(r).toMatchObject({ reversed: 0, pending: 1 });
    expect(wallet.rollbacks).toHaveLength(0);
  });
});

describe("the casino's own wallet (RoutingWallet)", () => {
  it("routes an operator with a webhook to the casino, falls back to the sandbox only where allowed, else declines before any money moves", async () => {
    const c2 = buildContainer(CONFIG, { wallet: new SandboxWallet() });
    const withHook = c2.mgmt.createOperator({ name: "W", slug: "w" });
    c2.mgmt.setWebhook(withHook.id, "https://casino.example.com/wallet");
    const without = c2.mgmt.createOperator({ name: "N", slug: "n" });
    const calls: string[] = [];
    const fakeCasino: WalletAdapter = {
      balance: async () => { calls.push("casino"); return { amount: 1, currency: "GEL" }; },
      debit: async () => ({ operatorTxRef: "x", status: "confirmed" }),
      credit: async () => ({ operatorTxRef: "x", status: "confirmed" }),
      rollback: async () => ({ operatorTxRef: "x", status: "rolled_back" })
    };
    const sandbox = new SandboxWallet();
    sandbox.setBalance("p", "GEL", 42);
    const dev = new RoutingWallet(c2.mgmt, fakeCasino, sandbox);
    const prod = new RoutingWallet(c2.mgmt, fakeCasino, null);
    const args = { operatorPlayerId: "p", currency: "GEL" };

    expect((await prod.balance({ operatorId: withHook.id }, args)).amount).toBe(1);
    expect(calls).toEqual(["casino"]);
    expect((await dev.balance({ operatorId: without.id }, args)).amount).toBe(42);
    await expect(prod.debit({ operatorId: without.id }, { idempotencyKey: "k", roundRef: "r", operatorPlayerId: "p", amount: 1, currency: "GEL" }))
      .rejects.toBeInstanceOf(WalletDeclinedError);
    await expect(prod.balance({ operatorId: without.id }, args)).rejects.toMatchObject({ code: "WEBHOOK_NOT_CONFIGURED" });
  });
});

describe("production boot guard", () => {
  it("refuses a live operator without a wallet webhook; sandbox operators and configured ones pass", () => {
    const c3 = buildContainer(CONFIG, {});
    const live = c3.mgmt.createOperator({ name: "Live", slug: "live" });
    c3.mgmt.createOperator({ name: "Sbx", slug: "sbx" }); // status sandbox: allowed
    expect(() => assertLiveOperatorsHaveWallets(c3)).not.toThrow();
    c3.mgmt.setOperatorStatus(live.id, "live");
    expect(() => assertLiveOperatorsHaveWallets(c3)).toThrow(/without a wallet webhook: live/);
    c3.mgmt.setWebhook(live.id, "https://casino.example.com/wallet");
    expect(() => assertLiveOperatorsHaveWallets(c3)).not.toThrow();
  });
});
