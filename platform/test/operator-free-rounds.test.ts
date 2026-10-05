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

describe("operator API — free-round cancel", () => {
  beforeEach(setup);
  const cancel = (as: "a" | "b", body: object) => signed(as, "POST", "/operator/v1/free-rounds/cancel", body);
  const auditActions = (op: string) => c.auditRepo.list({ operator_id: op }).map((e) => e.action);

  it("cancels one player's grant; the other players keep theirs; a repeat changes nothing", async () => {
    c.campaigns.grantPlayers(ops.a.campaign, ["p1", "p2"]);
    const res = await cancel("a", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      scope: "player", cancelled: true, already_cancelled: false,
      grant: { campaign_id: ops.a.campaign, status: "cancelled", spins_remaining: 10 }
    });
    const byPlayer = Object.fromEntries(c.campaigns.listGrants(ops.a.campaign).map((g) => [g.operator_player_id, g.status]));
    expect(byPlayer).toEqual({ p1: "cancelled", p2: "active" });
    expect(c.campaigns.getCampaign(ops.a.campaign)!.status).toBe("active");

    const again = await cancel("a", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ cancelled: false, already_cancelled: true, grant: { status: "cancelled" } });
    expect(auditActions(ops.a.id).filter((a) => a === "campaign.grant.cancel")).toHaveLength(1);
  });

  it("cancels a whole campaign and all its active grants, idempotently", async () => {
    c.campaigns.grantPlayers(ops.a.campaign, ["p1", "p2"]);
    const res = await cancel("a", { campaign_id: ops.a.campaign });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scope: "campaign", cancelled: true, already_cancelled: false, campaign_id: ops.a.campaign, status: "cancelled", grants_cancelled: 2 });
    expect(c.campaigns.listGrants(ops.a.campaign).every((g) => g.status === "cancelled")).toBe(true);
    const again = await cancel("a", { campaign_id: ops.a.campaign });
    expect(again.json()).toMatchObject({ cancelled: false, already_cancelled: true, grants_cancelled: 0 });
    expect(auditActions(ops.a.id).filter((a) => a === "campaign.cancel")).toHaveLength(1);
    // A cancelled campaign can't be granted again.
    expect((await signed("a", "POST", "/operator/v1/free-rounds/grant", { campaign_id: ops.a.campaign, operator_player_id: "p3" })).statusCode).toBe(409);
  });

  it("another operator cannot cancel (or detect) a campaign it does not own", async () => {
    c.campaigns.grantPlayers(ops.a.campaign, ["p1"]);
    for (const body of [{ campaign_id: ops.a.campaign }, { campaign_id: ops.a.campaign, operator_player_id: "p1" }]) {
      const res = await cancel("b", body);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("CAMPAIGN_NOT_FOUND");
    }
    expect(c.campaigns.getCampaign(ops.a.campaign)!.status).toBe("active");
    expect(c.campaigns.listGrants(ops.a.campaign)[0].status).toBe("active");
    expect(auditActions(ops.a.id).some((a) => a.includes("cancel"))).toBe(false);
  });

  it("validates the body; an unknown player is 404; unsigned calls are rejected", async () => {
    expect((await cancel("a", {})).statusCode).toBe(422);
    expect((await cancel("a", { campaign_id: ops.a.campaign, operator_player_id: "  " })).statusCode).toBe(422);
    expect((await cancel("a", { campaign_id: ops.a.campaign, operator_player_id: 7 })).statusCode).toBe(422);
    expect((await cancel("a", { campaign_id: "cmp_missing" })).statusCode).toBe(404);
    const unknown = await cancel("a", { campaign_id: ops.a.campaign, operator_player_id: "nobody" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("GRANT_NOT_FOUND");
    const unsigned = await app.inject({ method: "POST", url: "/operator/v1/free-rounds/cancel", headers: { "content-type": "application/json" }, payload: JSON.stringify({ campaign_id: ops.a.campaign }) });
    expect(unsigned.statusCode).toBe(401);
  });

  it("played free rounds stand; after the cancel the player's next spin is a cash spin", async () => {
    c.mgmt.addDomain(ops.a.id, "casino-a.example.com", "prod");
    (c.wallet as SandboxWallet).setBalance("p1", "GEL", 100);
    c.campaigns.grantPlayers(ops.a.campaign, ["p1"]);
    const lt = c.sessions.createLaunchToken({ operator_id: ops.a.id, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino-a.example.com" });
    const session = c.sessions.initSession(lt);
    const play = (bet: number) => c.orchestrator.spin(session.id, { bet_amount: bet, idempotency_key: randomUUID() });
    // Play two free rounds (skip ahead if one triggers the scatter feature: those spins are owed).
    let freeRoundsPlayed = 0;
    while (freeRoundsPlayed < 2) {
      const out = await play(1);
      if (out.free_round) freeRoundsPlayed += 1;
      while (c.sessions.get(session.id).free_spins_left > 0) await play(1);
    }
    const before = c.campaigns.listGrants(ops.a.campaign)[0];
    expect(before.spins_remaining).toBe(8);

    const res = await cancel("a", { campaign_id: ops.a.campaign, operator_player_id: "p1" });
    expect(res.json()).toMatchObject({ cancelled: true, grant: { status: "cancelled", spins_remaining: 8 } });
    const playedRounds = c.reporting.listRoundsByPlayer(ops.a.id, "p1").filter((r) => r.campaign_id === ops.a.campaign && !r.is_free_spin);
    expect(playedRounds).toHaveLength(2); // the rounds already played stand

    const balanceBefore = (await c.wallet.balance({ operatorId: ops.a.id }, { operatorPlayerId: "p1", currency: "GEL" })).amount;
    const next = await play(1);
    expect(next.free_round).toBeNull();
    expect(next.bet_charged).toBe(1);
    const balanceAfter = (await c.wallet.balance({ operatorId: ops.a.id }, { operatorPlayerId: "p1", currency: "GEL" })).amount;
    expect(balanceAfter).toBeCloseTo(balanceBefore - 1 + next.total_win, 2);
    expect(c.campaigns.listGrants(ops.a.campaign)[0].spins_remaining).toBe(8);
  });
});
