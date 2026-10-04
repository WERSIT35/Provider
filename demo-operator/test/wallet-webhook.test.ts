import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { PlayerStore } from "../src/store/player-store";
import { computeSignature } from "../../platform/src/lib/security/hmac";
import { FakePlatformClient, testConfig } from "./support/fake-platform-client";

const CONFIG = testConfig({ webhookSecret: "the-real-webhook-secret" });

let app: FastifyInstance;
let store: PlayerStore;
let playerId: string;

function signedHeaders(path: string, rawBody: string, opts: { timestamp?: string; secret?: string } = {}): Record<string, string> {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(opts.secret ?? CONFIG.webhookSecret, { timestamp, method: "POST", path, rawBody });
  return { "content-type": "application/json", "x-timestamp": timestamp, "x-nonce": randomUUID(), "x-signature": signature };
}

beforeEach(async () => {
  store = new PlayerStore();
  const platform = new FakePlatformClient();
  app = buildApp({ config: CONFIG, store, platformFactory: () => platform, logger: false });
  await app.ready();
  playerId = store.register("wallet-player@example.com", "hash", 500).id;
});

describe("Wallet webhook signature verification", () => {
  it("rejects a call with no signature headers", async () => {
    const body = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers: { "content-type": "application/json" }, payload: body });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
  });

  it("rejects a tampered signature", async () => {
    const body = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const headers = signedHeaders("/wallet/default-provider/balance", body);
    headers["x-signature"] = "0".repeat(64);
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers, payload: body });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("SIGNATURE_INVALID");
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const body = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const headers = signedHeaders("/wallet/default-provider/balance", body, { secret: "not-the-real-secret" });
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers, payload: body });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("SIGNATURE_INVALID");
  });

  it("rejects an expired timestamp", async () => {
    const body = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const stale = String(Math.floor(Date.now() / 1000) - 10_000);
    const headers = signedHeaders("/wallet/default-provider/balance", body, { timestamp: stale });
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers, payload: body });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("TIMESTAMP_SKEW");
  });

  it("accepts a correctly signed call and returns the real balance", async () => {
    const body = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers: signedHeaders("/wallet/default-provider/balance", body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ amount: 500, currency: "GEL" });
  });
});

describe("Wallet webhook business logic", () => {
  it("debit moves the real balance and declines when funds are insufficient", async () => {
    const body = JSON.stringify({ idempotencyKey: "k1:debit", roundRef: "r1", operatorPlayerId: playerId, amount: 100, currency: "GEL" });
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/debit", headers: signedHeaders("/wallet/default-provider/debit", body), payload: body });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { balanceAfter: { amount: number } }).balanceAfter.amount).toBe(400);

    const tooMuch = JSON.stringify({ idempotencyKey: "k2:debit", roundRef: "r2", operatorPlayerId: playerId, amount: 9999, currency: "GEL" });
    const declined = await app.inject({ method: "POST", url: "/wallet/default-provider/debit", headers: signedHeaders("/wallet/default-provider/debit", tooMuch), payload: tooMuch });
    expect(declined.statusCode).toBe(402);
    expect(declined.json().error).toBe("INSUFFICIENT_FUNDS");
  });

  it("credit increases the balance", async () => {
    const body = JSON.stringify({ idempotencyKey: "k3:credit", roundRef: "r3", operatorPlayerId: playerId, amount: 25, currency: "GEL" });
    const res = await app.inject({ method: "POST", url: "/wallet/default-provider/credit", headers: signedHeaders("/wallet/default-provider/credit", body), payload: body });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { balanceAfter: { amount: number } }).balanceAfter.amount).toBe(525);
  });

  it("a retried debit with the same idempotencyKey is applied only once", async () => {
    const body = JSON.stringify({ idempotencyKey: "dup:debit", roundRef: "r4", operatorPlayerId: playerId, amount: 50, currency: "GEL" });
    const headers1 = signedHeaders("/wallet/default-provider/debit", body);
    const first = await app.inject({ method: "POST", url: "/wallet/default-provider/debit", headers: headers1, payload: body });
    const headers2 = signedHeaders("/wallet/default-provider/debit", body); // fresh timestamp/nonce, same idempotencyKey in the body
    const second = await app.inject({ method: "POST", url: "/wallet/default-provider/debit", headers: headers2, payload: body });
    expect(first.json()).toEqual(second.json());

    const balBody = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const bal = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers: signedHeaders("/wallet/default-provider/balance", balBody), payload: balBody });
    expect((bal.json() as { amount: number }).amount).toBe(450); // charged once, not twice
  });

  it("rollback reverses the exact debit it targets", async () => {
    const debitBody = JSON.stringify({ idempotencyKey: "k5:debit", roundRef: "r5", operatorPlayerId: playerId, amount: 60, currency: "GEL" });
    const debitRes = await app.inject({ method: "POST", url: "/wallet/default-provider/debit", headers: signedHeaders("/wallet/default-provider/debit", debitBody), payload: debitBody });
    const { operatorTxRef } = debitRes.json() as { operatorTxRef: string };

    const rollbackBody = JSON.stringify({ idempotencyKey: "k5:rollback", originalOperatorTxRef: operatorTxRef, roundRef: "r5" });
    const rollbackRes = await app.inject({ method: "POST", url: "/wallet/default-provider/rollback", headers: signedHeaders("/wallet/default-provider/rollback", rollbackBody), payload: rollbackBody });
    expect(rollbackRes.statusCode).toBe(200);
    expect(rollbackRes.json()).toMatchObject({ status: "rolled_back" });

    const balBody = JSON.stringify({ operatorPlayerId: playerId, currency: "GEL" });
    const bal = await app.inject({ method: "POST", url: "/wallet/default-provider/balance", headers: signedHeaders("/wallet/default-provider/balance", balBody), payload: balBody });
    expect((bal.json() as { amount: number }).amount).toBe(500); // back to the starting balance
  });
});
