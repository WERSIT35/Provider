import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { computeSignature } from "../src/lib/security/hmac";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };
const IN_A_WEEK = () => new Date(Date.now() + 7 * 864e5).toISOString();

let app: FastifyInstance;
let c: Container;
const ops: Record<"a" | "b", { id: string; key: string; secret: string; campaign: string }> = {} as never;

async function setup() {
  c = buildContainer(CONFIG, { wallet: new SandboxWallet() });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  for (const slug of ["a", "b"] as const) {
    const op = c.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
    const cred = c.mgmt.issueCredential(op.id, "prod");
    const campaign = c.campaigns.createCampaign({
      operator_id: op.id, game_id: game.id, name: `Promo ${slug}`, currency: "GEL", bet_amount: 5, total_spins: 10,
      valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: IN_A_WEEK(), created_by: "seed"
    });
    ops[slug] = { id: op.id, key: cred.credential.api_key_id, secret: cred.api_secret, campaign: campaign.id };
  }
}

/** Signed operator-API call (signature covers method + path + raw body). */
function signed(as: "a" | "b", method: "GET" | "POST", path: string, body?: object, tamper?: (h: Record<string, string>) => void) {
  const rawBody = body ? JSON.stringify(body) : "";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "x-api-key": ops[as].key,
    "x-timestamp": timestamp,
    "x-nonce": randomUUID(),
    "x-signature": computeSignature(ops[as].secret, { timestamp, method, path, rawBody })
  };
  if (body) headers["content-type"] = "application/json";
  tamper?.(headers);
  return app.inject({ method, url: path, headers, ...(body ? { payload: rawBody } : {}) });
}

describe("operator API — free rounds", () => {
  beforeEach(setup);

  it("grants a campaign to a player, idempotently", async () => {
    const first = await signed("a", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      already_granted: false,
      grant: { campaign_id: ops.a.campaign, game_code: "bananax", bet_amount: 5, spins_granted: 10, spins_remaining: 10, status: "active" }
    });

    // The casino retries after a timeout: same grant back, never topped up.
    const retry = await signed("a", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ already_granted: true, grant: { spins_remaining: 10 } });
    expect(c.campaigns.listGrants(ops.a.campaign)).toHaveLength(1);
    expect(c.auditRepo.list({ operator_id: ops.a.id }).filter((e) => e.action === "campaign.grant")).toHaveLength(1);
  });

  it("refuses another operator's campaign as if it didn't exist", async () => {
    const res = await signed("b", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("CAMPAIGN_NOT_FOUND");
    expect(c.campaigns.listGrants(ops.a.campaign)).toHaveLength(0);
  });

  it("validates the body and refuses a cancelled campaign", async () => {
    expect((await signed("a", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign })).statusCode).toBe(422);
    expect((await signed("a", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign, operator_player_id: "  " })).statusCode).toBe(422);
    c.campaigns.cancelCampaign(ops.a.campaign);
    const res = await signed("a", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(res.statusCode).toBe(409);
  });

  it("lists only the calling operator's open grants for a player", async () => {
    c.campaigns.grantPlayers(ops.a.campaign, ["p1"]);
    c.campaigns.grantPlayers(ops.b.campaign, ["p1"]); // same player id at another casino
    const res = await signed("a", "GET", "/operator/v1/free-rounds/player/p1");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; grants: Array<{ campaign_id: string; bet_amount: number; spins_remaining: number }> };
    expect(body.count).toBe(1);
    expect(body.grants[0]).toMatchObject({ campaign_id: ops.a.campaign, bet_amount: 5, spins_remaining: 10 });

    // Exhausted / cancelled grants are not "open".
    c.campaigns.cancelCampaign(ops.a.campaign);
    expect(((await signed("a", "GET", "/operator/v1/free-rounds/player/p1")).json() as { count: number }).count).toBe(0);
    expect(((await signed("a", "GET", "/operator/v1/free-rounds/player/nobody")).json() as { count: number }).count).toBe(0);
  });

  it("sits behind HMAC: unsigned, tampered, replayed and wrong-key calls are rejected", async () => {
    const body = { campaign_id: ops.a.campaign, operator_player_id: "p1" };
    expect((await app.inject({ method: "GET", url: "/operator/v1/free-rounds/player/p1" })).statusCode).toBe(401);
    // Signature for a different player path → mismatch (the path is signed).
    const swapped = await signed("a", "GET", "/operator/v1/free-rounds/player/p1", undefined, (h) => {
      h["x-signature"] = computeSignature(ops.a.secret, { timestamp: h["x-timestamp"], method: "GET", path: "/operator/v1/free-rounds/player/p2", rawBody: "" });
    });
    expect(swapped.statusCode).toBe(401);
    // B's key with A's signature.
    expect((await signed("a", "POST", "/operator/v1/free-rounds/grant", body, (h) => (h["x-api-key"] = ops.b.key))).statusCode).toBe(401);
    // Replay: same nonce twice.
    let nonce = "";
    const once = await signed("a", "POST", "/operator/v1/free-rounds/grant", body, (h) => (nonce = h["x-nonce"]));
    expect(once.statusCode).toBe(201);
    const replay = await signed("a", "POST", "/operator/v1/free-rounds/grant", body, (h) => (h["x-nonce"] = nonce));
    expect((replay.json() as { error: { code: string } }).error.code).toBe("REPLAY_DETECTED");
  });
});
