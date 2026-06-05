import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";

const CONFIG = {
  launchSecret: "s1",
  sessionSecret: "s2",
  adminSecret: "s3",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000
};

let app: FastifyInstance;
let container: Container;
let opAId: string;
let opBId: string;

async function provisionAndPlay(): Promise<void> {
  const wallet = new SandboxWallet();
  container = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
  await app.ready();

  // Game catalog is global: register the game + approved config once.
  const game = container.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = container.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = container.mgmt.submitMathConfigForReview(cfg.id);
  cfg = container.mgmt.approveMathConfig(cfg.id, "lead");

  for (const slug of ["a", "b"]) {
    const op = container.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    container.mgmt.addDomain(op.id, "casino.example.com", "prod");
    container.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
    wallet.setBalance(`p_${slug}`, "GEL", 1000);
    const token = container.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: `p_${slug}`, currency: "GEL", origin: "casino.example.com" });
    const session = container.sessions.initSession(token);
    for (let i = 0; i < 5; i += 1) {
      await container.orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: `${slug}-${i}` });
    }
    if (slug === "a") opAId = op.id;
    else opBId = op.id;
  }
}

function providerToken(): string {
  return container.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
}
function operatorToken(operatorId: string): string {
  return container.adminAuth.mintToken({ admin_id: "opadm-1", scope: "operator", operator_id: operatorId, role: "operator_admin" });
}

describe("Admin API (RBAC + tenant scoping)", () => {
  beforeEach(async () => {
    await provisionAndPlay();
  });

  it("rejects requests without an admin token", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/v1/operators" });
    expect(res.statusCode).toBe(401);
  });

  it("lets a provider admin list all operators and see cross-tenant rounds", async () => {
    const token = providerToken();
    const ops = await app.inject({ method: "GET", url: "/admin/v1/operators", headers: { authorization: `Bearer ${token}` } });
    expect(ops.statusCode).toBe(200);
    expect((ops.json() as { operators: unknown[] }).operators.length).toBe(2);

    const rounds = await app.inject({ method: "GET", url: "/admin/v1/rounds", headers: { authorization: `Bearer ${token}` } });
    expect((rounds.json() as { count: number }).count).toBe(10); // 5 + 5 across both operators
  });

  it("scopes an operator admin to ONLY its own data", async () => {
    const token = operatorToken(opAId);
    const rounds = await app.inject({ method: "GET", url: "/admin/v1/rounds", headers: { authorization: `Bearer ${token}` } });
    const body = rounds.json() as { rounds: Array<{ operator_id: string }>; count: number };
    expect(body.count).toBe(5);
    expect(body.rounds.every((r) => r.operator_id === opAId)).toBe(true);

    // Even if it tries to request operator B, the scope is forced back to its own.
    const spoof = await app.inject({ method: "GET", url: `/admin/v1/rounds?operator_id=${opBId}`, headers: { authorization: `Bearer ${token}` } });
    const spoofBody = spoof.json() as { rounds: Array<{ operator_id: string }> };
    expect(spoofBody.rounds.every((r) => r.operator_id === opAId)).toBe(true);
  });

  it("forbids an operator admin from the provider-only operators list", async () => {
    const token = operatorToken(opAId);
    const res = await app.inject({ method: "GET", url: "/admin/v1/operators", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it("serves GGR/RTP/reconciliation reports", async () => {
    const token = providerToken();
    const summary = await app.inject({ method: "GET", url: `/admin/v1/reports/summary?operator_id=${opAId}`, headers: { authorization: `Bearer ${token}` } });
    expect((summary.json() as { rounds: number }).rounds).toBe(5);

    const recon = await app.inject({ method: "GET", url: "/admin/v1/reports/reconciliation", headers: { authorization: `Bearer ${token}` } });
    expect((recon.json() as { ok: boolean }).ok).toBe(true);
  });
});
