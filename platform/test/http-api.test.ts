import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { computeSignature } from "../src/lib/security/hmac";

const CONFIG = {
  launchSecret: "test-launch-secret",
  sessionSecret: "test-session-secret",
  adminSecret: "test-admin-secret",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000
};
const PLAYER = "p_http";
const ORIGIN = "casino.example.com";

let app: FastifyInstance;
let container: Container;
let wallet: SandboxWallet;
let apiKeyId: string;
let apiSecret: string;

/** Provision an operator with an assigned game + active credential. */
function provision(): void {
  const op = container.mgmt.createOperator({ name: "Casino HTTP", slug: "casino-http" });
  container.mgmt.addDomain(op.id, ORIGIN, "prod");
  const game = container.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = container.mgmt.createMathConfig({
    game_id: game.id,
    version: "3.0.0",
    rtp_profile_key: "bananax",
    theoretical_rtp: 96.38,
    config_hash: "h"
  });
  cfg = container.mgmt.submitMathConfigForReview(cfg.id);
  cfg = container.mgmt.approveMathConfig(cfg.id, "lead");
  container.mgmt.assignGame({
    operator_id: op.id,
    game_id: game.id,
    math_config_id: cfg.id,
    currency: "GEL",
    allowed_bets: [1, 5, 500]
  });
  const issued = container.mgmt.issueCredential(op.id, "prod");
  apiKeyId = issued.credential.api_key_id;
  apiSecret = issued.api_secret;
  wallet.setBalance(PLAYER, "GEL", 1000);
}

/** Build signed operator-API headers for a POST body. */
function signedHeaders(path: string, rawBody: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(apiSecret, { timestamp, method: "POST", path, rawBody });
  return {
    "content-type": "application/json",
    "x-api-key": apiKeyId,
    "x-timestamp": timestamp,
    "x-nonce": randomUUID(),
    "x-signature": signature
  };
}

async function launchAndInit(): Promise<{ sessionToken: string }> {
  const body = JSON.stringify({ game_code: "bananax", operator_player_id: PLAYER, currency: "GEL", origin: ORIGIN });
  const launchRes = await app.inject({
    method: "POST",
    url: "/operator/v1/launch",
    headers: signedHeaders("/operator/v1/launch", body),
    payload: body
  });
  expect(launchRes.statusCode).toBe(200);
  const { launch_token } = launchRes.json() as { launch_token: string };

  const initRes = await app.inject({
    method: "POST",
    url: "/game/v1/session/init",
    headers: { authorization: `Bearer ${launch_token}` }
  });
  expect(initRes.statusCode).toBe(200);
  return { sessionToken: (initRes.json() as { session_token: string }).session_token };
}

describe("HTTP API (operator + game) with HMAC + bearer auth", () => {
  beforeEach(async () => {
    wallet = new SandboxWallet();
    container = buildContainer(CONFIG, { wallet });
    app = buildApp({
      logger: createLogger({ level: "silent", pretty: false, env: "test" }),
      container
    });
    await app.ready();
    provision();
  });

  it("rejects an unsigned operator request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/operator/v1/launch",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ game_code: "bananax", operator_player_id: PLAYER, currency: "GEL", origin: ORIGIN })
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a tampered signature", async () => {
    const body = JSON.stringify({ game_code: "bananax", operator_player_id: PLAYER, currency: "GEL", origin: ORIGIN });
    const headers = signedHeaders("/operator/v1/launch", body);
    headers["x-signature"] = "deadbeef";
    const res = await app.inject({ method: "POST", url: "/operator/v1/launch", headers, payload: body });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("SIGNATURE_INVALID");
  });

  it("rejects a replayed nonce", async () => {
    const body = JSON.stringify({ game_code: "bananax", operator_player_id: PLAYER, currency: "GEL", origin: ORIGIN });
    const headers = signedHeaders("/operator/v1/launch", body);
    const first = await app.inject({ method: "POST", url: "/operator/v1/launch", headers, payload: body });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: "/operator/v1/launch", headers, payload: body });
    expect(second.statusCode).toBe(401);
    expect((second.json() as { error: { code: string } }).error.code).toBe("REPLAY_DETECTED");
  });

  it("launches, inits a session, and spins over HTTP", async () => {
    const { sessionToken } = await launchAndInit();
    const res = await app.inject({
      method: "POST",
      url: "/game/v1/spin",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json", "idempotency-key": "http-k1" },
      payload: JSON.stringify({ bet_amount: 1 })
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { round_ref: string; balance: { amount: number }; total_win: number };
    expect(out.round_ref).toBe("r_http-k1");
    expect(out.balance.amount).toBeCloseTo(1000 - 1 + out.total_win, 2);

    // Round lookup is available and tenant-scoped.
    const lookup = await app.inject({
      method: "GET",
      url: "/game/v1/rounds/r_http-k1",
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(lookup.statusCode).toBe(200);
    expect((lookup.json() as { outcome_hash: string }).outcome_hash).toHaveLength(64);
  });

  it("buys free spins over HTTP: charges the buy cost and awards free spins", async () => {
    const { sessionToken } = await launchAndInit();
    const buyCost = 1 * container.engine.buyCostMultiplier();
    const res = await app.inject({
      method: "POST",
      url: "/game/v1/buy-feature",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json", "idempotency-key": "http-buy1" },
      payload: JSON.stringify({ bet_amount: 1 })
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { round_ref: string; bet_charged: number; free_spins_left: number; balance: { amount: number }; total_win: number };
    expect(out.round_ref).toBe("r_http-buy1");
    expect(out.bet_charged).toBeCloseTo(buyCost, 2);
    expect(out.free_spins_left).toBeGreaterThan(0);
    expect(out.balance.amount).toBeCloseTo(1000 - buyCost + out.total_win, 2);

    // The follow-up free spin is free (charge 0).
    const fs = await app.inject({
      method: "POST",
      url: "/game/v1/spin",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json", "idempotency-key": "http-fs1" },
      payload: JSON.stringify({ bet_amount: 1 })
    });
    expect(fs.statusCode).toBe(200);
    expect((fs.json() as { bet_charged: number }).bet_charged).toBe(0);
  });

  it("requires an Idempotency-Key on spin and is idempotent when given one", async () => {
    const { sessionToken } = await launchAndInit();
    const noKey = await app.inject({
      method: "POST",
      url: "/game/v1/spin",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      payload: JSON.stringify({ bet_amount: 1 })
    });
    expect(noKey.statusCode).toBe(422);

    const headers = { authorization: `Bearer ${sessionToken}`, "content-type": "application/json", "idempotency-key": "dup-http" };
    const a = await app.inject({ method: "POST", url: "/game/v1/spin", headers, payload: JSON.stringify({ bet_amount: 1 }) });
    const b = await app.inject({ method: "POST", url: "/game/v1/spin", headers, payload: JSON.stringify({ bet_amount: 1 }) });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotent-replay"]).toBe("true");
    expect((a.json() as { balance: { amount: number } }).balance.amount).toBe(
      (b.json() as { balance: { amount: number } }).balance.amount
    );
  });
});
