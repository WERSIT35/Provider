import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { WalletDeclinedError, type DebitArgs, type RollbackArgs } from "../src/modules/wallet/wallet.types";
import { DEBIT_OUTCOME_UNKNOWN } from "../src/modules/wallet/transaction-store";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const START = 1_000;

/** Network faults, switchable per test. */
const faults: {
  debit: (args: DebitArgs) => "lost" | "unreachable" | null;
  rollbackDown: boolean;
} = { debit: () => null, rollbackDown: false };
let debitCalls: DebitArgs[] = [];
let rollbackCalls: RollbackArgs[] = [];

let app: FastifyInstance;
let c: Container;
let wallet: SandboxWallet;
let opId: string;
let key = 0;

async function setup() {
  faults.debit = () => null;
  faults.rollbackDown = false;
  debitCalls = [];
  rollbackCalls = [];
  wallet = new SandboxWallet({
    debitFault: (args) => {
      debitCalls.push(args);
      return faults.debit(args);
    },
    rollbackUnreachable: (args) => {
      rollbackCalls.push(args);
      return faults.rollbackDown;
    }
  });
  c = buildContainer(CONFIG, { wallet, debitRetryDelaysMs: [0, 0] });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 10] });
  wallet.setBalance("p1", "GEL", START);
}

async function session(): Promise<string> {
  const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  const res = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  expect(res.statusCode).toBe(200);
  return res.json().session_token;
}
const call = (path: string, token: string, idem: string, body: object) =>
  app.inject({ method: "POST", url: `/game/v1/${path}`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": idem }, payload: JSON.stringify(body) });
const balance = async () => (await wallet.balance({ operatorId: opId }, { operatorPlayerId: "p1", currency: "GEL" })).amount;
const txs = (roundRef: string) => c.transactions.list({ round_ref: roundRef });
const adminToken = () => c.adminAuth.mintToken({ admin_id: "ops", scope: "provider", role: "provider_finance" });

describe("lost debit responses", () => {
  beforeEach(setup);

  it("a response lost once is retried in line: the round plays, debited once", async () => {
    const token = await session();
    let n = 0;
    faults.debit = () => (n++ === 0 ? "lost" : null);
    const res = await call("spin", token, `k${key++}`, { bet_amount: 5 });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(debitCalls).toHaveLength(2);
    expect(new Set(debitCalls.map((d) => d.idempotencyKey)).size).toBe(1); // same key both times
    expect(await balance()).toBeCloseTo(START - 5 + out.total_win, 2);
    expect(rollbackCalls).toHaveLength(0);
    expect(c.transactions.listPendingReversals()).toHaveLength(0);
  });

  it("an outcome that stays unknown voids the round and refunds the stake the casino did take", async () => {
    const token = await session();
    faults.debit = () => "lost"; // applied every time, answer always lost
    const idem = `k${key++}`;
    const res = await call("spin", token, idem, { bet_amount: 5 });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("DEBIT_UNCONFIRMED");
    expect(debitCalls).toHaveLength(3); // first try + 2 in-line retries, all one key
    expect(await balance()).toBe(START); // the stake came back
    // The reversal named the debit by its key (the RGS never got an operatorTxRef).
    expect(rollbackCalls).toHaveLength(1);
    expect(rollbackCalls[0]).toMatchObject({ originalIdempotencyKey: `${idem}:debit`, operatorPlayerId: "p1", amount: 5, currency: "GEL" });
    expect(rollbackCalls[0].originalOperatorTxRef).toBeUndefined();
    // Money ledger: an unknown debit and its reversal; no round was played.
    const rows = txs(`r_${idem}`);
    expect(rows.map((t) => [t.type, t.status, t.error_code ?? null])).toEqual([
      ["DEBIT", "failed", DEBIT_OUTCOME_UNKNOWN],
      ["ROLLBACK", "rolled_back", null]
    ]);
    expect(c.ledger.getRound(`r_${idem}`)).toBeNull();
    expect(c.transactions.listPendingReversals()).toHaveLength(0);
    expect(c.reporting.reconcile(opId).ok).toBe(true);
  });

  it("a voided round stays voided: retrying its key never debits again", async () => {
    const token = await session();
    faults.debit = () => "lost";
    const idem = `k${key++}`;
    expect((await call("spin", token, idem, { bet_amount: 5 })).statusCode).toBe(502);
    faults.debit = () => null; // the casino is fine again
    const calls = debitCalls.length;
    const retry = await call("spin", token, idem, { bet_amount: 5 });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("ROUND_VOIDED");
    expect(debitCalls).toHaveLength(calls);
    expect(await balance()).toBe(START);
    // A fresh spin plays normally.
    expect((await call("spin", token, `k${key++}`, { bet_amount: 1 })).statusCode).toBe(200);
  });

  it("a debit that never arrived is voided at the casino: when it turns up late it is refused", async () => {
    const token = await session();
    faults.debit = () => "unreachable";
    const idem = `k${key++}`;
    expect((await call("spin", token, idem, { bet_amount: 5 })).statusCode).toBe(502);
    expect(await balance()).toBe(START);
    // The delayed original finally reaches the wallet: refused, nothing moves.
    faults.debit = () => null;
    await expect(
      wallet.debit({ operatorId: opId }, { idempotencyKey: `${idem}:debit`, roundRef: `r_${idem}`, operatorPlayerId: "p1", amount: 5, currency: "GEL" })
    ).rejects.toMatchObject({ code: "TRANSACTION_VOIDED" });
    expect(await balance()).toBe(START);
  });

  it("casino down for the reversal too: it is queued, listed for ops, and the sweep refunds exactly once", async () => {
    const token = await session();
    faults.debit = () => "lost";
    faults.rollbackDown = true;
    const idem = `k${key++}`;
    expect((await call("spin", token, idem, { bet_amount: 10 })).statusCode).toBe(502);
    expect(await balance()).toBe(START - 10); // the casino holds the stake for now
    expect(c.transactions.listPendingReversals().map((t) => t.round_ref)).toEqual([`r_${idem}`]);
    expect(c.reporting.reconcile(opId).ok).toBe(true); // an unknown debit is not a counted one

    const list = await app.inject({ method: "GET", url: "/admin/v1/transactions/pending-reversals", headers: { authorization: `Bearer ${adminToken()}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ count: 1, pending_reversals: [{ round_ref: `r_${idem}`, amount: 10, status: "failed", error_code: DEBIT_OUTCOME_UNKNOWN }] });

    // Still down: the sweep leaves it queued.
    expect(await c.debits.sweep((t) => c.sessions.tryGet(t.session_id)?.operator_player_id)).toEqual({ reversed: 0, pending: 1 });
    // Back up: refunded, dequeued; further sweeps move nothing.
    faults.rollbackDown = false;
    expect(await c.debits.sweep()).toEqual({ reversed: 1, pending: 0 });
    expect(await balance()).toBe(START);
    expect(await c.debits.sweep()).toEqual({ reversed: 0, pending: 0 });
    expect(await balance()).toBe(START);
    expect(new Set(rollbackCalls.map((r) => r.idempotencyKey)).size).toBe(1); // every attempt under one key
  });

  it("the background job sweeps the queue at start-up", async () => {
    const token = await session();
    faults.debit = () => "lost";
    faults.rollbackDown = true;
    expect((await call("spin", token, `k${key++}`, { bet_amount: 5 })).statusCode).toBe(502);
    faults.rollbackDown = false;
    // A restarted app sweeps on ready.
    const app2 = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
    await app2.ready();
    await expect.poll(() => c.transactions.listPendingReversals().length).toBe(0);
    expect(await balance()).toBe(START);
    await app2.close();
  });

  it("a buy whose debit outcome stays unknown is voided and refunded the same way", async () => {
    const token = await session();
    faults.debit = () => "lost";
    const idem = `k${key++}`;
    const res = await call("buy-feature", token, idem, { bet_amount: 1 });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("DEBIT_UNCONFIRMED");
    expect(await balance()).toBe(START);
    expect(c.sessions.get(c.sessions.listByOperator(opId)[0].id).free_spins_left).toBe(0);
  });

  it("a definite decline is not retried and needs no reversal", async () => {
    const token = await session();
    wallet.setBalance("p1", "GEL", 2);
    const res = await call("spin", token, `k${key++}`, { bet_amount: 5 });
    expect(res.statusCode).toBe(402);
    expect(debitCalls).toHaveLength(1);
    expect(rollbackCalls).toHaveLength(0);
    expect(c.transactions.listPendingReversals()).toHaveLength(0);
  });

  it("isOutcomeUnknown: declines and never-sent errors are definite, transport failures are not", async () => {
    const { isOutcomeUnknown } = await import("../src/modules/wallet/wallet.types");
    expect(isOutcomeUnknown(new WalletDeclinedError("INSUFFICIENT_FUNDS"))).toBe(false);
    expect(isOutcomeUnknown(new Error("WEBHOOK_NOT_CONFIGURED"))).toBe(false);
    expect(isOutcomeUnknown(new Error("WEBHOOK_CALL_FAILED"))).toBe(true);
    expect(isOutcomeUnknown(new Error("socket hang up"))).toBe(true);
  });
});
