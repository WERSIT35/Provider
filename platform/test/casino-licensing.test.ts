import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { computeSignature } from "../src/lib/security/hmac";
import { WebhookWallet } from "../src/modules/wallet/webhook-wallet";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { createMockCasinoWallet, type MockCasinoWallet } from "./support/mock-casino-wallet";

const CONFIG = {
  launchSecret: "test-launch-secret",
  sessionSecret: "test-session-secret",
  adminSecret: "test-admin-secret",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000
};

function providerToken(container: Container): string {
  return container.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
}
function operatorToken(container: Container, operatorId: string): string {
  return container.adminAuth.mintToken({ admin_id: "opadm-1", scope: "operator", operator_id: operatorId, role: "operator_admin" });
}

/** Onboard a casino end to end (as the provider onboarding wizard would) and
 * return everything a test needs to launch + play as that casino. */
function onboardCasino(container: Container, opts: { name: string; slug: string; domain: string }) {
  const op = container.mgmt.createOperator({ name: opts.name, slug: opts.slug });
  container.mgmt.addDomain(op.id, opts.domain, "prod");
  const game = container.mgmt.registerGame({ code: `game-${opts.slug}`, title: "Test Game" });
  let cfg = container.mgmt.createMathConfig({
    game_id: game.id,
    version: "1.0.0",
    rtp_profile_key: "rtp",
    theoretical_rtp: 96,
    config_hash: "h"
  });
  cfg = container.mgmt.submitMathConfigForReview(cfg.id);
  cfg = container.mgmt.approveMathConfig(cfg.id, "lead");
  const entitlement = container.mgmt.assignGame({
    operator_id: op.id,
    game_id: game.id,
    math_config_id: cfg.id,
    currency: "GEL",
    allowed_bets: [1, 5, 10]
  });
  const issued = container.mgmt.issueCredential(op.id, "prod");
  return { operator: op, game, entitlement, apiKeyId: issued.credential.api_key_id, apiSecret: issued.api_secret };
}

function signedHeaders(apiKeyId: string, apiSecret: string, path: string, rawBody: string): Record<string, string> {
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

async function launchAndInit(
  app: FastifyInstance,
  args: { apiKeyId: string; apiSecret: string; gameCode: string; playerRef: string; currency: string; origin: string }
): Promise<{ sessionToken: string } | { statusCode: number; code: string }> {
  const body = JSON.stringify({ game_code: args.gameCode, operator_player_id: args.playerRef, currency: args.currency, origin: args.origin });
  const launchRes = await app.inject({
    method: "POST",
    url: "/operator/v1/launch",
    headers: signedHeaders(args.apiKeyId, args.apiSecret, "/operator/v1/launch", body),
    payload: body
  });
  if (launchRes.statusCode !== 200) {
    return { statusCode: launchRes.statusCode, code: (launchRes.json() as { error: { code: string } }).error.code };
  }
  const { launch_token } = launchRes.json() as { launch_token: string };
  const initRes = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${launch_token}` } });
  expect(initRes.statusCode).toBe(200);
  return { sessionToken: (initRes.json() as { session_token: string }).session_token };
}

describe("Casino licensing: onboarding, entitlements, and self-service", () => {
  let app: FastifyInstance;
  let container: Container;

  beforeEach(async () => {
    container = buildContainer(CONFIG, { wallet: new SandboxWallet() });
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
    await app.ready();
  });

  it("onboard casino → grant entitlement → casino admin API shows the game", async () => {
    const { operator, entitlement } = onboardCasino(container, { name: "Casino A", slug: "casino-a", domain: "a.example.com" });
    const token = operatorToken(container, operator.id);
    const res = await app.inject({ method: "GET", url: "/admin/v1/operator-games", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { operator_games: Array<{ id: string; lobby_enabled: boolean }> }).operator_games;
    expect(rows.map((r) => r.id)).toContain(entitlement.id);
    expect(rows[0].lobby_enabled).toBe(true);
  });

  it("casino can configure their own slots-section display for an entitlement", async () => {
    const { operator, entitlement } = onboardCasino(container, { name: "Casino B", slug: "casino-b", domain: "b.example.com" });
    const token = operatorToken(container, operator.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/v1/operator-games/${entitlement.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: "Lucky Bananas", thumbnail_url: "https://cdn.example.com/t.png", sort_order: 3, lobby_enabled: false }
    });
    expect(res.statusCode).toBe(200);
    const og = (res.json() as { operator_game: { display_name: string; sort_order: number; lobby_enabled: boolean } }).operator_game;
    expect(og.display_name).toBe("Lucky Bananas");
    expect(og.sort_order).toBe(3);
    expect(og.lobby_enabled).toBe(false);
  });

  it("revoking an entitlement immediately blocks new launches for that game", async () => {
    const c = onboardCasino(container, { name: "Casino C", slug: "casino-c", domain: "c.example.com" });
    const providerTok = providerToken(container);

    const before = await launchAndInit(app, {
      apiKeyId: c.apiKeyId,
      apiSecret: c.apiSecret,
      gameCode: c.game.code,
      playerRef: "p1",
      currency: "GEL",
      origin: "c.example.com"
    });
    expect("sessionToken" in before).toBe(true);

    const revoke = await app.inject({
      method: "POST",
      url: `/admin/v1/operator-games/${c.entitlement.id}/status`,
      headers: { authorization: `Bearer ${providerTok}` },
      payload: { status: "disabled" }
    });
    expect(revoke.statusCode).toBe(200);

    const after = await launchAndInit(app, {
      apiKeyId: c.apiKeyId,
      apiSecret: c.apiSecret,
      gameCode: c.game.code,
      playerRef: "p1",
      currency: "GEL",
      origin: "c.example.com"
    });
    expect("code" in after && after.code).toBe("GAME_NOT_ASSIGNED");
  });

  it("rejects a launch signed with an expired timestamp", async () => {
    const c = onboardCasino(container, { name: "Casino D", slug: "casino-d", domain: "d.example.com" });
    const body = JSON.stringify({ game_code: c.game.code, operator_player_id: "p1", currency: "GEL", origin: "d.example.com" });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10_000);
    const signature = computeSignature(c.apiSecret, { timestamp: staleTimestamp, method: "POST", path: "/operator/v1/launch", rawBody: body });
    const res = await app.inject({
      method: "POST",
      url: "/operator/v1/launch",
      headers: {
        "content-type": "application/json",
        "x-api-key": c.apiKeyId,
        "x-timestamp": staleTimestamp,
        "x-nonce": randomUUID(),
        "x-signature": signature
      },
      payload: body
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("TIMESTAMP_SKEW");
  });

  it("casino-scoped endpoints cannot read or modify another casino's entitlements, credentials, or webhook", async () => {
    const a = onboardCasino(container, { name: "Casino E", slug: "casino-e", domain: "e.example.com" });
    const b = onboardCasino(container, { name: "Casino F", slug: "casino-f", domain: "f.example.com" });
    const tokenA = operatorToken(container, a.operator.id);
    const headersA = { authorization: `Bearer ${tokenA}` };

    // A cannot toggle/patch B's entitlement.
    const patchOther = await app.inject({ method: "PATCH", url: `/admin/v1/operator-games/${b.entitlement.id}`, headers: headersA, payload: { lobby_enabled: false } });
    expect(patchOther.statusCode).toBe(404);

    // A cannot list or rotate B's credentials.
    const listOther = await app.inject({ method: "GET", url: `/admin/v1/operators/${b.operator.id}/credentials`, headers: headersA });
    expect(listOther.statusCode).toBe(403);
    const rotateOther = await app.inject({ method: "POST", url: `/admin/v1/operators/${b.operator.id}/credentials/${b.apiKeyId}/rotate`, headers: headersA, payload: {} });
    expect(rotateOther.statusCode).toBe(403);

    // A cannot read or set B's webhook.
    const getOther = await app.inject({ method: "GET", url: `/admin/v1/operators/${b.operator.id}/webhook`, headers: headersA });
    expect(getOther.statusCode).toBe(403);
    const putOther = await app.inject({ method: "PUT", url: `/admin/v1/operators/${b.operator.id}/webhook`, headers: headersA, payload: { url: "http://evil.example.com/wallet" } });
    expect(putOther.statusCode).toBe(403);

    // A CAN manage its own.
    const own = await app.inject({ method: "GET", url: `/admin/v1/operators/${a.operator.id}/credentials`, headers: headersA });
    expect(own.statusCode).toBe(200);
  });

  it("casino can rotate its own API credential without provider involvement", async () => {
    const c = onboardCasino(container, { name: "Casino G", slug: "casino-g", domain: "g.example.com" });
    const token = operatorToken(container, c.operator.id);
    const res = await app.inject({
      method: "POST",
      url: `/admin/v1/operators/${c.operator.id}/credentials/${c.apiKeyId}/rotate`,
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { credential: { api_key_id: string }; api_secret: string };
    expect(body.api_secret).toBeTruthy();
    expect(body.credential.api_key_id).not.toBe(c.apiKeyId);
  });
});

describe("Wallet webhook: casino-held funds over a signed HTTP callback", () => {
  let app: FastifyInstance;
  let container: Container;
  let mockWallet: MockCasinoWallet;

  beforeEach(async () => {
    container = buildContainer(CONFIG, { walletFactory: (mgmt) => new WebhookWallet(mgmt) });
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
    await app.ready();
  });

  afterEach(async () => {
    if (mockWallet) await mockWallet.stop();
  });

  it("routes debit/credit through the casino's signed webhook and keeps the audit chain intact", async () => {
    const c = onboardCasino(container, { name: "Casino Webhook", slug: "casino-webhook", domain: "wh.example.com" });

    // Provision the webhook: the platform generates a secret first (placeholder
    // URL), then the mock casino wallet is started with that same secret, then
    // the real URL is registered (secret kept, per setWebhook's contract).
    const first = container.mgmt.setWebhook(c.operator.id, "http://placeholder.invalid/wallet");
    const secret = first.secret as string;
    mockWallet = createMockCasinoWallet(secret);
    await mockWallet.start();
    mockWallet.setBalance("p_wh", "GEL", 1000);
    container.mgmt.setWebhook(c.operator.id, mockWallet.url);

    const launched = await launchAndInit(app, {
      apiKeyId: c.apiKeyId,
      apiSecret: c.apiSecret,
      gameCode: c.game.code,
      playerRef: "p_wh",
      currency: "GEL",
      origin: "wh.example.com"
    });
    if (!("sessionToken" in launched)) throw new Error("launch failed");

    let lastRoundRef = "";
    let lastTotalWin = 0;
    for (let i = 0; i < 8; i++) {
      const key = `wh-spin-${i}`;
      const res = await app.inject({
        method: "POST",
        url: "/game/v1/spin",
        headers: { authorization: `Bearer ${launched.sessionToken}`, "content-type": "application/json", "idempotency-key": key },
        payload: JSON.stringify({ bet_amount: 1 })
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { round_ref: string; total_win: number };
      lastRoundRef = out.round_ref;
      lastTotalWin = out.total_win;
    }

    // Every debit call reached the mock casino wallet, correctly signed (the
    // preHandler itself rejects bad signatures with 401, so a 200 spin response
    // proves the signature verified) and carrying the right idempotency key shape.
    const debits = mockWallet.calls.filter((c2) => c2.action === "debit");
    expect(debits.length).toBe(8);
    expect(debits[0].body.idempotencyKey).toBe("wh-spin-0:debit");
    expect(debits[0].body.currency).toBe("GEL");

    // Debit always precedes its round's credit (when a round won).
    for (const call of mockWallet.calls) {
      if (call.action === "credit") {
        const roundKey = String(call.body.idempotencyKey).replace(":credit", ":debit");
        const debitIdx = mockWallet.calls.findIndex((x) => x.action === "debit" && x.body.idempotencyKey === roundKey);
        const creditIdx = mockWallet.calls.indexOf(call);
        expect(debitIdx).toBeGreaterThanOrEqual(0);
        expect(debitIdx).toBeLessThan(creditIdx);
      }
    }
    void lastTotalWin;

    // The round(s) are recorded in the hash-chained ledger and the chain verifies.
    expect(container.ledger.getRound(lastRoundRef)).toBeTruthy();
    const integrity = container.ledger.verifyIntegrity();
    expect(integrity.rounds.ok).toBe(true);
    expect(integrity.audit.ok).toBe(true);
  });

  it("declines play when the casino has not configured a wallet webhook yet", async () => {
    const c = onboardCasino(container, { name: "Casino NoHook", slug: "casino-nohook", domain: "nh.example.com" });
    const body = JSON.stringify({ game_code: c.game.code, operator_player_id: "p_nh", currency: "GEL", origin: "nh.example.com" });
    const launchRes = await app.inject({
      method: "POST",
      url: "/operator/v1/launch",
      headers: signedHeaders(c.apiKeyId, c.apiSecret, "/operator/v1/launch", body),
      payload: body
    });
    expect(launchRes.statusCode).toBe(200);
    const { launch_token } = launchRes.json() as { launch_token: string };

    // session/init reads the initial balance, so the missing webhook surfaces
    // immediately rather than only once the player tries to spin.
    const initRes = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${launch_token}` } });
    expect(initRes.statusCode).toBe(502);
    expect((initRes.json() as { error: { code: string } }).error.code).toBe("WEBHOOK_NOT_CONFIGURED");
  });
});
