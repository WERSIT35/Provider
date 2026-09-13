import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildContainer, type Container } from "../../platform/src/container";
import { buildApp as buildPlatformApp } from "../../platform/src/app";
import { createLogger } from "../../platform/src/lib/logger";
import { WebhookWallet } from "../../platform/src/modules/wallet/webhook-wallet";
import { buildApp as buildDemoOperatorApp } from "../src/app";
import { PlatformClient } from "../src/lib/platform-client";
import type { DemoOperatorConfig } from "../src/config";

/**
 * Runs BOTH services for real (real listening ports, real HTTP, real HMAC-signed
 * requests both directions) and exercises the whole story end to end: onboard →
 * register a player → see the seeded game in the lobby (nothing hardcoded) →
 * launch it → play rounds → confirm demo-operator's real balance moved via the
 * signed wallet webhook → confirm the platform's own operator dashboard
 * (GET /admin/v1/reports/overview) reflects that activity.
 */
describe("End-to-end: platform + demo-operator over real HTTP", () => {
  let platformApp: ReturnType<typeof buildPlatformApp>;
  let container: Container;
  let demoApp: ReturnType<typeof buildDemoOperatorApp>;
  let cfg: DemoOperatorConfig;
  let operatorId: string;
  let operatorAdminToken: string;

  beforeAll(async () => {
    container = buildContainer(
      {
        launchSecret: "e2e-launch-secret",
        sessionSecret: "e2e-session-secret",
        adminSecret: "e2e-admin-secret",
        hmacSkewSeconds: 30,
        rateLimitPerMin: 10_000
      },
      { walletFactory: (mgmt) => new WebhookWallet(mgmt) }
    );

    // Onboard exactly the way the Provider console would.
    const op = container.mgmt.createOperator({ name: "E2E Demo Operator", slug: "e2e-demo-operator" });
    operatorId = op.id;
    container.mgmt.addDomain(op.id, "demo-operator.local", "prod");
    const game = container.mgmt.registerGame({ code: "bananax", title: "Banana X" });
    let cfgMc = container.mgmt.createMathConfig({
      game_id: game.id,
      version: "1.0.0",
      rtp_profile_key: "bananax",
      theoretical_rtp: 96.38,
      config_hash: "h"
    });
    cfgMc = container.mgmt.approveMathConfig(container.mgmt.submitMathConfigForReview(cfgMc.id).id, "lead");
    container.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfgMc.id, currency: "GEL", allowed_bets: [1, 5, 10] });
    const entitlement = container.mgmt.listOperatorGames(op.id)[0];
    container.mgmt.updateOperatorGameDisplay(entitlement.id, { display_name: "Banana X (E2E)", lobby_enabled: true, sort_order: 0 });
    const issued = container.mgmt.issueCredential(op.id, "prod");
    operatorAdminToken = container.adminAuth.mintToken({ admin_id: "e2e-admin", scope: "operator", operator_id: op.id, role: "operator_admin" });

    // Boot the platform for real (ephemeral port).
    platformApp = buildPlatformApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
    await platformApp.listen({ host: "127.0.0.1", port: 0 });
    const platformAddr = platformApp.server.address();
    if (!platformAddr || typeof platformAddr === "string") throw new Error("platform not listening");
    const platformUrl = `http://127.0.0.1:${platformAddr.port}`;

    // Boot demo-operator for real too — the webhook needs somewhere real to call.
    cfg = {
      port: 0,
      platformUrl,
      operatorId: op.id,
      apiKeyId: issued.credential.api_key_id,
      apiSecret: issued.api_secret,
      webhookSecret: "placeholder", // set for real just below, once we know demo-operator's own address
      adminToken: operatorAdminToken,
      origin: "demo-operator.local",
      gameCode: "bananax",
      currency: "GEL",
      sessionSecret: "e2e-player-session-secret",
      startingBalance: 1000
    };
    demoApp = buildDemoOperatorApp({ config: cfg, platform: new PlatformClient(cfg), logger: false });
    await demoApp.listen({ host: "127.0.0.1", port: 0 });
    const demoAddr = demoApp.server.address();
    if (!demoAddr || typeof demoAddr === "string") throw new Error("demo-operator not listening");

    // Register the webhook now that we know demo-operator's real address, and
    // patch cfg.webhookSecret so demo-operator's own HMAC verification uses the
    // secret the platform actually signs with (mirrors the two-step dance the
    // real seed script does — see platform/scripts/seed-demo-operator.ts).
    const webhook = container.mgmt.setWebhook(op.id, `http://127.0.0.1:${demoAddr.port}/wallet`);
    (cfg as { webhookSecret: string }).webhookSecret = webhook.secret as string;
  });

  afterAll(async () => {
    await demoApp.close();
    await platformApp.close();
  });

  it("register → lobby → launch → play → real balance + admin dashboard reflect it", async () => {
    // 1) Register a player on the demo site.
    const reg = await demoApp.inject({ method: "POST", url: "/api/register", payload: { email: "player1@example.com", password: "correcthorse" } });
    expect(reg.statusCode).toBe(200);
    const { token, player } = reg.json() as { token: string; player: { id: string; balance: number } };
    expect(player.balance).toBe(1000);

    // 2) The lobby shows exactly the one game seeded above — live from the platform.
    const lobby = await demoApp.inject({ method: "GET", url: "/api/lobby" });
    expect(lobby.statusCode).toBe(200);
    const lobbyGames = (lobby.json() as { games: Array<{ game_code: string; display_name: string }> }).games;
    expect(lobbyGames).toHaveLength(1);
    expect(lobbyGames[0].game_code).toBe("bananax");
    expect(lobbyGames[0].display_name).toBe("Banana X (E2E)");

    // 3) Launch — this is a REAL signed HTTP call from demo-operator to platform.
    const play = await demoApp.inject({ method: "POST", url: "/api/play/bananax", headers: { authorization: `Bearer ${token}` } });
    expect(play.statusCode).toBe(200);
    const { launch_url } = play.json() as { launch_url: string };
    const launchToken = new URL(launch_url).searchParams.get("lt") as string;
    expect(launchToken).toBeTruthy();

    // 4) session/init — this makes a REAL signed wallet.balance webhook call OUT
    // to demo-operator's real listening port, proving the callback works over
    // the wire (not in-process).
    const initRes = await platformApp.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${launchToken}` } });
    expect(initRes.statusCode).toBe(200);
    const init = initRes.json() as { session_token: string; balance: { amount: number } };
    expect(init.balance.amount).toBe(1000);

    // 5) Play several rounds so we exercise both debit and (probabilistically) credit.
    for (let i = 0; i < 10; i++) {
      const spin = await platformApp.inject({
        method: "POST",
        url: "/game/v1/spin",
        headers: { authorization: `Bearer ${init.session_token}`, "content-type": "application/json", "idempotency-key": `e2e-spin-${i}` },
        payload: JSON.stringify({ bet_amount: 5 })
      });
      expect(spin.statusCode).toBe(200);
    }

    // 6) demo-operator's REAL balance reflects every bet/win — it is the source
    // of truth for the player's funds, and it only ever learned about them via
    // the signed webhook.
    const account = await demoApp.inject({ method: "GET", url: "/api/account", headers: { authorization: `Bearer ${token}` } });
    expect(account.statusCode).toBe(200);
    const accountBody = account.json() as { player: { balance: number }; transactions: Array<{ type: string }> };
    expect(accountBody.transactions.length).toBeGreaterThanOrEqual(10); // at least 10 debits, plus any credits
    expect(accountBody.player.balance).not.toBe(1000); // money actually moved

    // 7) The platform's OWN operator dashboard (the existing admin console API)
    // reflects real activity generated by the demo site — extended, not duplicated.
    const overview = await platformApp.inject({ method: "GET", url: "/admin/v1/reports/overview", headers: { authorization: `Bearer ${operatorAdminToken}` } });
    expect(overview.statusCode).toBe(200);
    const overviewBody = overview.json() as {
      distinct_players: number;
      sessions_total: number;
      rounds: number;
      total_bet: number;
      recent_transactions: unknown[];
    };
    expect(overviewBody.distinct_players).toBe(1);
    expect(overviewBody.sessions_total).toBe(1);
    expect(overviewBody.rounds).toBe(10);
    expect(overviewBody.total_bet).toBe(50);
    expect(overviewBody.recent_transactions.length).toBeGreaterThan(0);

    // Sanity: the platform's own hash-chained ledger still verifies after all this.
    const integrity = container.ledger.verifyIntegrity();
    expect(integrity.rounds.ok).toBe(true);
    expect(integrity.audit.ok).toBe(true);

    void operatorId;
  });
});
