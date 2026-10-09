import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app";
import { buildContainer, type Container } from "../../src/container";
import { createLogger } from "../../src/lib/logger";
import { SandboxWallet } from "../../src/modules/wallet/sandbox-wallet";
import { signToken } from "../../src/lib/tokens";
import { metrics } from "../../src/lib/metrics";
import type { SpinResult } from "../../src/modules/engine/engine.types";

/**
 * Game-logic abuse suite (production plan, Phase 3A). Every test is an attack a player
 * (or a compromised client) could try against the RGS, and proves it fails with NO money
 * moved: no debit, no round, balance unchanged. The fear it guards: a player boosting
 * multipliers, switching on crazy mode, or paying less than the round costs.
 */

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const START = 1_000;

let app: FastifyInstance;
let c: Container;
let wallet: SandboxWallet;
let opId: string;

async function setup() {
  wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  wallet.setBalance("p1", "GEL", START);
  wallet.setBalance("p2", "GEL", START);
}

async function sessionToken(player = "p1"): Promise<string> {
  const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
  const res = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  return res.json().session_token;
}

function post(url: string, token: string, payload: string, key: string = randomUUID()) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": key },
    payload
  });
}
const spin = (token: string, body: unknown, key?: string) => post("/game/v1/spin", token, JSON.stringify(body), key);

const balance = async (player = "p1") => (await wallet.balance({ operatorId: opId }, { operatorPlayerId: player, currency: "GEL" })).amount;
const debits = () => c.transactions.list({ operator_id: opId }).filter((t) => t.type === "DEBIT");

/** Nothing happened: no money moved and no round was recorded. */
async function expectUntouched(player = "p1") {
  expect(debits()).toHaveLength(0);
  expect(c.roundsRepo.size()).toBe(0);
  expect(await balance(player)).toBe(START);
}

beforeEach(() => setup());

describe("outcome tampering never reaches the engine", () => {
  // Engine dev inputs and server-owned state a player might try to set.
  const TAMPERED: Array<Record<string, unknown>> = [
    { force_multiplier_value: 1000 },
    { forceMultiplierValue: 1000 },
    { force_free_spin_trigger: true },
    { crazyMode: true },
    { crazy_mode: true },
    { free_spins_left: 50 },
    { freeSpinPersistentMultiplier: 500 },
    { multiplier: 1000 },
    { seed: "00".repeat(32) },
    { rng_seed_hex: "00".repeat(32) },
    { rtp_profile: { payout_scaler: 100 } },
    { game_id: "bananax_crazy" },
    { balance: 1e9 },
    { skip_bet_charge: true },
    { bet_charged: 0 }
  ];

  it.each(TAMPERED.map((extra) => [Object.keys(extra)[0], extra]))("refuses a spin carrying %s (422, nothing debited)", async (_name, extra) => {
    const token = await sessionToken();
    const res = await spin(token, { bet_amount: 1, ...(extra as object) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
    await expectUntouched();
  });

  it("refuses the same tampering on a feature buy", async () => {
    const token = await sessionToken();
    for (const extra of TAMPERED) {
      const res = await post("/game/v1/buy-feature", token, JSON.stringify({ bet_amount: 1, ...extra }));
      expect(res.statusCode, JSON.stringify(extra)).toBe(422);
    }
    await expectUntouched();
  });

  it("refuses prototype-poisoning bodies before any handler runs", async () => {
    const token = await sessionToken();
    for (const body of ['{"bet_amount":1,"__proto__":{"crazyMode":true}}', '{"bet_amount":1,"constructor":{"prototype":{"crazyMode":true}}}']) {
      const res = await post("/game/v1/spin", token, body);
      expect(res.statusCode, body).toBe(400);
    }
    expect(({} as Record<string, unknown>).crazyMode).toBeUndefined();
    await expectUntouched();
  });

  it("the engine boundary ignores crazy mode and forced multipliers even if a caller passes them", () => {
    const seed = "ab".repeat(32);
    const clean = c.engine.resolveDeterministic({}, { bet_amount: 1 }, seed).result;
    const poisoned = c.engine.resolveDeterministic(
      { crazyMode: true, forceMultiplierValue: 1000 } as never,
      { bet_amount: 1, force_multiplier_value: 1000, force_free_spin_trigger: true, crazyMode: true } as never,
      seed
    ).result;
    expect(poisoned).toEqual(clean);
    expect(poisoned.crazy_mode).toBe(false);
  });

  it("fails closed: a crazy-mode result is refused, the debit rolled back, nothing recorded", async () => {
    const original = c.engine.resolveDeterministic.bind(c.engine);
    c.engine.resolveDeterministic = (snap, input, seed) => {
      const out = original(snap, input, seed);
      return { ...out, result: { ...out.result, crazy_mode: true } as SpinResult };
    };
    const before = metrics.engineIntegrity.render?.() ?? "";
    const token = await sessionToken();
    const res = await spin(token, { bet_amount: 1 });
    expect(res.statusCode).toBe(500);
    // A bare internal error: nothing about the guard or the engine reaches the player.
    expect(res.json().error).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal error" });
    expect(res.body).not.toContain("ENGINE_INTEGRITY");
    expect(c.roundsRepo.size()).toBe(0);
    expect(await balance()).toBe(START);
    const types = c.transactions.list({ operator_id: opId }).map((t) => t.type).sort();
    expect(types).toEqual(["DEBIT", "ROLLBACK"]);
    expect(metrics.engineIntegrity.render?.() ?? "x").not.toBe(before);
  });

  it("fails closed: a result paying more than the 20,000x cap is refused", async () => {
    const original = c.engine.resolveDeterministic.bind(c.engine);
    c.engine.resolveDeterministic = (snap, input, seed) => {
      const out = original(snap, input, seed);
      return { ...out, result: { ...out.result, total_win: 20_000 * input.bet_amount + 1 } as SpinResult };
    };
    const token = await sessionToken();
    expect((await spin(token, { bet_amount: 1 })).statusCode).toBe(500);
    expect(c.roundsRepo.size()).toBe(0);
    expect(await balance()).toBe(START);
  });
});

describe("bet abuse", () => {
  const BAD_BODIES: unknown[] = [
    {}, { bet_amount: 0 }, { bet_amount: -1 }, { bet_amount: -0.01 }, { bet_amount: "5" }, { bet_amount: null },
    { bet_amount: [1] }, { bet_amount: { $gt: 0 } }, { bet_amount: true }, { bet_amount: 1e308 }, { bet_amount: 2 },
    { bet_amount: 0.30000000000000004 }, { bet_amount: 1.0000001 }, { bet_amount: 1, ante_enabled: "false" },
    { bet_amount: 1, ante_enabled: 1 }, [], [{ bet_amount: 1 }], "1", 1, null
  ];

  it.each(BAD_BODIES.map((b) => [JSON.stringify(b), b]))("refuses %s with a 4xx and moves no money", async (_label, body) => {
    const token = await sessionToken();
    const res = await spin(token, body);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    await expectUntouched();
  });

  it("refuses a malformed or oversized body", async () => {
    const token = await sessionToken();
    expect((await post("/game/v1/spin", token, "{bet_amount:1")).statusCode).toBe(400);
    expect((await post("/game/v1/spin", token, JSON.stringify({ bet_amount: 1, pad: "x".repeat(100 * 1024) }))).statusCode).toBe(413);
    await expectUntouched();
  });

  it("refuses an Idempotency-Key that could smuggle data into round refs or wallet keys", async () => {
    const token = await sessionToken();
    for (const key of ["", "a b", "a/b", "x".repeat(129), "k\u0000", "../etc", "k\n1", "ключ"]) {
      const res = await app.inject({
        method: "POST",
        url: "/game/v1/spin",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": key },
        payload: JSON.stringify({ bet_amount: 1 })
      }).catch(() => null);
      if (res) expect(res.statusCode, JSON.stringify(key)).toBe(422);
    }
    await expectUntouched();
  });
});

describe("idempotency keys are single-use and tied to their session", () => {
  it("another session cannot replay a key: no peek at that player's round, no free debit", async () => {
    const a = await sessionToken("p1");
    const b = await sessionToken("p2");
    expect((await spin(a, { bet_amount: 1 }, "shared-key")).statusCode).toBe(200);
    const res = await spin(b, { bet_amount: 1 }, "shared-key");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(JSON.stringify(res.json())).not.toContain("r_shared-key\",\"outcome_hash");
    expect(await balance("p2")).toBe(START);
    expect(debits()).toHaveLength(1);
  });

  it("the same session's retry is a verbatim replay (no second debit)", async () => {
    const a = await sessionToken();
    const first = await spin(a, { bet_amount: 1 }, "retry-1");
    const again = await spin(a, { bet_amount: 5 }, "retry-1"); // even with a different bet
    expect(again.statusCode).toBe(200);
    expect(again.json().round_ref).toBe(first.json().round_ref);
    expect(again.json().idempotent_replay).toBe(true);
    expect(debits()).toHaveLength(1);
  });

  it("a key whose round was rolled back cannot be replayed into a free round", async () => {
    const original = c.engine.resolveDeterministic.bind(c.engine);
    let fail = true;
    c.engine.resolveDeterministic = (snap, input, seed) => {
      if (fail) {
        fail = false;
        throw new Error("engine down");
      }
      return original(snap, input, seed);
    };
    const a = await sessionToken();
    const failed = await spin(a, { bet_amount: 1 }, "rb-1");
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain("engine down");
    const retry = await spin(a, { bet_amount: 1 }, "rb-1");
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(debits()).toHaveLength(1); // the original, rolled back; no new one
    expect(await balance()).toBe(START);
  });

  it("20 concurrent copies of one spin play exactly one round", async () => {
    const a = await sessionToken();
    const results = await Promise.all(Array.from({ length: 20 }, () => spin(a, { bet_amount: 1 }, "burst-1")));
    for (const r of results) expect([200, 409]).toContain(r.statusCode);
    expect(debits()).toHaveLength(1);
    expect(c.roundsRepo.size()).toBe(1);
  });

  it("2 concurrent copies of one buy buy once", async () => {
    const a = await sessionToken();
    const results = await Promise.all([0, 1].map(() => post("/game/v1/buy-feature", a, JSON.stringify({ bet_amount: 1 }), "buy-burst")));
    // The second copy is refused while the first runs (409), or replays it once done (200).
    for (const r of results) expect([200, 409]).toContain(r.statusCode);
    expect(debits()).toHaveLength(1);
    expect(c.roundsRepo.size()).toBe(1);
  });
});

describe("one round at a time per session", () => {
  // A real casino answers a debit in tens of ms: that latency is the race window.
  beforeEach(() => {
    const debit = wallet.debit.bind(wallet);
    wallet.debit = async (ctx, args) => {
      await new Promise((r) => setTimeout(r, 25));
      return debit(ctx, args);
    };
  });

  it("2 concurrent buys with different keys: one feature, paid once", async () => {
    const a = await sessionToken();
    const results = await Promise.all(["buy-a", "buy-b"].map((k) => post("/game/v1/buy-feature", a, JSON.stringify({ bet_amount: 1 }), k)));
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    expect(debits()).toHaveLength(1);
    const lost = results.find((r) => r.statusCode !== 200)!;
    expect(lost.statusCode).toBe(409);
  });

  it("a spin racing a buy: the session never plays both against one feature", async () => {
    const a = await sessionToken();
    const [buy, sp] = await Promise.all([
      post("/game/v1/buy-feature", a, JSON.stringify({ bet_amount: 1 }), "race-buy"),
      spin(a, { bet_amount: 1 }, "race-spin")
    ]);
    for (const r of [buy, sp]) expect(r.statusCode, r.body).toBeLessThan(500);
    expect(debits().length).toBe([buy, sp].filter((r) => r.statusCode === 200 && !r.json().is_free_spin).length);
  });
});

describe("money invariant under concurrent play", () => {
  it("40 concurrent spins with distinct keys: never a 5xx, and the wallet matches the ledgers exactly", async () => {
    const a = await sessionToken();
    const results = await Promise.all(Array.from({ length: 40 }, () => spin(a, { bet_amount: 1 })));
    for (const r of results) expect(r.statusCode, r.body).toBeLessThan(500);
    const txs = c.transactions.list({ operator_id: opId });
    const sum = (type: string) => txs.filter((t) => t.type === type && t.status !== "failed").reduce((s, t) => s + t.amount, 0);
    const expected = START - sum("DEBIT") + sum("CREDIT") + sum("ROLLBACK");
    expect(await balance()).toBeCloseTo(expected, 2);
    // Every recorded round was paid for by exactly one debit (or was a free spin).
    for (const round of c.roundsRepo.list({ operator_id: opId })) {
      const d = txs.filter((t) => t.round_ref === round.round_ref && t.type === "DEBIT");
      expect(d.length, round.round_ref).toBe(round.is_free_spin ? 0 : 1);
    }
    expect(c.ledger.verifyIntegrity()).toMatchObject({ rounds: { ok: true }, audit: { ok: true } });
  });
});

describe("session tokens", () => {
  it("refuses a forged, tampered, wrong-secret or expired session token", async () => {
    const real = await sessionToken();
    const [body, sig] = real.split(".");
    const flipped = `${body}.${sig.slice(0, -2)}${sig.slice(-2) === "AA" ? "BB" : "AA"}`;
    const otherSecret = signToken("not-the-secret", { session_id: "x", operator_id: opId }, 3600);
    const expired = signToken(CONFIG.sessionSecret, { session_id: "x", operator_id: opId }, -10);
    for (const token of [flipped, otherSecret, expired, "", "null", `${body}.`, "a.b.c"]) {
      const res = await spin(token, { bet_amount: 1 });
      expect(res.statusCode, token).toBe(401);
    }
    await expectUntouched();
  });

  it("a launch token is not a session token", async () => {
    const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
    expect((await spin(lt, { bet_amount: 1 })).statusCode).toBe(401);
    await expectUntouched();
  });
});

describe("security headers", () => {
  it("admin consoles cannot be framed; /play keeps its own framing policy", async () => {
    for (const url of ["/provider", "/admin"]) {
      const res = await app.inject({ method: "GET", url });
      if (String(res.headers["content-type"]).startsWith("text/html")) {
        expect(res.headers["content-security-policy"], url).toContain("frame-ancestors 'none'");
        expect(res.headers["x-frame-options"], url).toBe("DENY");
      }
    }
    const play = await app.inject({ method: "GET", url: "/play/" });
    expect(play.headers["content-security-policy"]).toContain("frame-ancestors");
  });

  it("API answers are no-store and nosniff", async () => {
    const token = await sessionToken();
    const res = await spin(token, { bet_amount: 1 });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("statistical guard on the real resolver", () => {
  it("3,000 server rounds: never crazy mode, never over the cap, never a negative win", () => {
    const cap = c.engine.maxWinMultiplier();
    for (let i = 0; i < 3_000; i++) {
      const bet = i % 2 ? 1 : 5;
      const round = i % 10 === 0 ? c.resolver.resolveBuy({}, { bet_amount: bet }) : c.resolver.resolve({ freeSpinsLeft: i % 7 === 0 ? 3 : 0 }, { bet_amount: bet, ante_enabled: i % 3 === 0 });
      expect(round.result.crazy_mode).not.toBe(true);
      expect(round.result.total_win).toBeGreaterThanOrEqual(0);
      expect(round.result.total_win).toBeLessThanOrEqual(cap * bet);
    }
  });
});
