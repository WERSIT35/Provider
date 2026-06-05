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

function providerToken(): string {
  return container.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
}
function operatorToken(operatorId: string): string {
  return container.adminAuth.mintToken({ admin_id: "opadm-1", scope: "operator", operator_id: operatorId, role: "operator_admin" });
}

beforeEach(async () => {
  container = buildContainer(CONFIG, { wallet: new SandboxWallet() });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
  await app.ready();
});

describe("Provisioning endpoints (provider-only)", () => {
  it("walks the full onboarding flow: operator → domain → credential → game → math config → assignment", async () => {
    const token = providerToken();
    const headers = { authorization: `Bearer ${token}` };

    const opRes = await app.inject({ method: "POST", url: "/admin/v1/operators", headers, payload: { name: "Casino Z", slug: "casino-z" } });
    expect(opRes.statusCode).toBe(200);
    const op = (opRes.json() as { operator: { id: string; slug: string } }).operator;
    expect(op.slug).toBe("casino-z");

    const domainRes = await app.inject({ method: "POST", url: `/admin/v1/operators/${op.id}/domains`, headers, payload: { domain: "play.example.com", environment: "prod" } });
    expect(domainRes.statusCode).toBe(200);

    const credRes = await app.inject({ method: "POST", url: `/admin/v1/operators/${op.id}/credentials`, headers, payload: { environment: "prod" } });
    expect(credRes.statusCode).toBe(200);
    const cred = credRes.json() as { credential: { api_key_id: string }; api_secret: string };
    expect(cred.api_secret).toBeTruthy();
    expect(cred.credential.api_key_id).toMatch(/^ak_/);

    const gameRes = await app.inject({ method: "POST", url: "/admin/v1/games", headers, payload: { code: "bananax", title: "Banana X" } });
    expect(gameRes.statusCode).toBe(200);
    const game = (gameRes.json() as { game: { id: string } }).game;

    // Unapproved math config → assign must fail.
    const draftRes = await app.inject({
      method: "POST",
      url: "/admin/v1/math-configs",
      headers,
      payload: { game_id: game.id, version: "1.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" }
    });
    expect(draftRes.statusCode).toBe(200);
    const draft = (draftRes.json() as { math_config: { id: string; status: string } }).math_config;
    expect(draft.status).toBe("draft");

    const tryAssign = await app.inject({
      method: "POST",
      url: `/admin/v1/operators/${op.id}/assignments`,
      headers,
      payload: { game_id: game.id, math_config_id: draft.id, currency: "GEL", allowed_bets: [1, 5] }
    });
    // CONFIG_NOT_APPROVED is surfaced as a 4xx by sendDomainError.
    expect(tryAssign.statusCode).toBeGreaterThanOrEqual(400);

    const approveRes = await app.inject({ method: "POST", url: `/admin/v1/math-configs/${draft.id}/approve`, headers, payload: { approver: "lead" } });
    expect(approveRes.statusCode).toBe(200);
    const approved = (approveRes.json() as { math_config: { status: string } }).math_config;
    expect(approved.status).toBe("approved");

    const assignRes = await app.inject({
      method: "POST",
      url: `/admin/v1/operators/${op.id}/assignments`,
      headers,
      payload: { game_id: game.id, math_config_id: draft.id, currency: "GEL", allowed_bets: [1, 5] }
    });
    expect(assignRes.statusCode).toBe(200);
    const og = (assignRes.json() as { operator_game: { allowed_bets: number[] } }).operator_game;
    expect(og.allowed_bets).toEqual([1, 5]);
  });

  it("rejects provisioning calls from an operator-scoped admin (403)", async () => {
    const setup = providerToken();
    const opRes = await app.inject({ method: "POST", url: "/admin/v1/operators", headers: { authorization: `Bearer ${setup}` }, payload: { name: "X", slug: "x" } });
    const op = (opRes.json() as { operator: { id: string } }).operator;
    const opTok = operatorToken(op.id);
    const r = await app.inject({ method: "POST", url: "/admin/v1/operators", headers: { authorization: `Bearer ${opTok}` }, payload: { name: "Y", slug: "y" } });
    expect(r.statusCode).toBe(403);
  });
});
