import { buildContainer, type Container } from "../../../platform/src/container";
import { buildApp as buildPlatformApp } from "../../../platform/src/app";
import { createLogger } from "../../../platform/src/lib/logger";
import { WebhookWallet } from "../../../platform/src/modules/wallet/webhook-wallet";
import { buildApp as buildDemoOperatorApp } from "../../src/app";
import { ProviderStore } from "../../src/store/provider-store";
import { PlayerStore } from "../../src/store/player-store";
import { openCasinoDb, type CasinoDatabase } from "../../src/db/database";
import type { DemoOperatorConfig } from "../../src/config";
import { randomUUID } from "node:crypto";

export type WebhookAction = "balance" | "debit" | "credit" | "rollback";

/**
 * Network faults injected into the platform's OUTBOUND wallet webhook calls. The
 * request always really reaches the casino; `loseResponse` then throws away the
 * casino's answer, exactly what a timeout after delivery looks like to the RGS.
 */
export interface Faults {
  loseResponse?: (action: WebhookAction, body: Record<string, unknown>) => boolean;
}

export interface Stack {
  container: Container;
  platform: ReturnType<typeof buildPlatformApp>;
  demo: ReturnType<typeof buildDemoOperatorApp>;
  /** The casino's own ledger (same SQLite handle the demo app writes). */
  store: PlayerStore;
  db: CasinoDatabase;
  faults: Faults;
  /** Back-office login for this run (random per stack; never a literal in the repo). */
  staff: { username: string; password: string };
  close(): Promise<void>;
}

/**
 * Both services for real: real listening ports, real HTTP, HMAC-signed calls both
 * ways (operator API in, wallet webhooks out). Mirrors the onboarding the Provider
 * console and platform/scripts/seed-demo-operator.ts perform.
 */
export async function startStack(opts: { startingBalance: number; allowedBets?: number[] }): Promise<Stack> {
  const faults: Faults = {};
  const faultyFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const action = new URL(String(input)).pathname.split("/").pop() as WebhookAction;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (faults.loseResponse?.(action, body)) throw new Error("socket hang up (response lost)");
    return res;
  };

  const container = buildContainer(
    { launchSecret: "e2e-launch", sessionSecret: "e2e-session", adminSecret: "e2e-admin", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 },
    { walletFactory: (mgmt) => new WebhookWallet(mgmt, { fetchImpl: faultyFetch }) }
  );
  const op = container.mgmt.createOperator({ name: "E2E Casino", slug: "e2e-casino" });
  container.mgmt.addDomain(op.id, "demo-operator.local", "prod");
  const game = container.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let mc = container.mgmt.createMathConfig({
    game_id: game.id,
    version: container.engine.rulesVersion(),
    rtp_profile_key: "bananax",
    theoretical_rtp: 96.38,
    config_hash: `sha256:${container.engine.rulesHash()}`
  });
  mc = container.mgmt.approveMathConfig(container.mgmt.submitMathConfigForReview(mc.id).id, "lead");
  container.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: mc.id, currency: "GEL", allowed_bets: opts.allowedBets ?? [1, 5, 10] });
  const entitlement = container.mgmt.listOperatorGames(op.id)[0];
  container.mgmt.updateOperatorGameDisplay(entitlement.id, { display_name: "Vault 20K", lobby_enabled: true, sort_order: 0 });
  const issued = container.mgmt.issueCredential(op.id, "prod");
  const adminToken = container.adminAuth.mintToken({ admin_id: "e2e-admin", scope: "operator", operator_id: op.id, role: "operator_admin" });

  const platform = buildPlatformApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
  await platform.listen({ host: "127.0.0.1", port: 0 });
  const pAddr = platform.server.address();
  if (!pAddr || typeof pAddr === "string") throw new Error("platform not listening");

  const cfg: DemoOperatorConfig = {
    port: 0,
    platformUrl: `http://127.0.0.1:${pAddr.port}`,
    operatorId: op.id,
    apiKeyId: issued.credential.api_key_id,
    apiSecret: issued.api_secret,
    webhookSecret: "placeholder",
    adminToken,
    origin: "demo-operator.local",
    gameCode: "bananax",
    currency: "GEL",
    sessionSecret: "e2e-player-session",
    startingBalance: opts.startingBalance,
    staffUsername: "e2e_staff",
    staffPassword: randomUUID()
  };
  const db = openCasinoDb(":memory:");
  const store = new PlayerStore(db);
  const providerStore = new ProviderStore(cfg, db);
  const demo = buildDemoOperatorApp({ config: cfg, providerStore, db, store, logger: false });
  await demo.listen({ host: "127.0.0.1", port: 0 });
  const dAddr = demo.server.address();
  if (!dAddr || typeof dAddr === "string") throw new Error("demo-operator not listening");

  // Webhook URL is only known once the casino listens; hand both sides the real secret.
  const webhook = container.mgmt.setWebhook(op.id, `http://127.0.0.1:${dAddr.port}/wallet/default-provider`);
  const { id: providerId, ...provider } = providerStore.getById("default-provider")!;
  providerStore.update(providerId, { ...provider, webhookSecret: webhook.secret as string });

  return {
    container, platform, demo, store, db, faults,
    staff: { username: cfg.staffUsername as string, password: cfg.staffPassword as string },
    async close() {
      await demo.close();
      await platform.close();
      db.close();
    }
  };
}

/** Register a casino player and open a game session on the platform; returns both handles. */
export async function newPlayer(stack: Stack, email: string) {
  const reg = await stack.demo.inject({ method: "POST", url: "/api/register", payload: { email, password: randomUUID() } });
  if (reg.statusCode !== 200) throw new Error(`register failed: ${reg.body}`);
  const { token, player } = reg.json() as { token: string; player: { id: string } };
  const play = await stack.demo.inject({ method: "POST", url: "/api/play/default-provider/bananax", headers: { authorization: `Bearer ${token}` } });
  const launchToken = new URL((play.json() as { launch_url: string }).launch_url).searchParams.get("lt") as string;
  const init = await stack.platform.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${launchToken}` } });
  const sessionToken = (init.json() as { session_token: string }).session_token;
  return { playerId: player.id, casinoToken: token, sessionToken };
}

/** A game-API call exactly as the game client makes it. */
export function gameCall(stack: Stack, sessionToken: string, path: "spin" | "buy-feature", key: string, body: Record<string, unknown>) {
  return stack.platform.inject({
    method: "POST",
    url: `/game/v1/${path}`,
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json", "idempotency-key": key },
    payload: JSON.stringify(body)
  });
}
