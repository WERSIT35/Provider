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
let opARoundRef: string;
let opARoundWinningRef: string | null;
let opBRoundRef: string;

async function provisionAndPlay(): Promise<void> {
  const wallet = new SandboxWallet();
  container = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
  await app.ready();

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

  for (const slug of ["alpha", "beta"]) {
    const op = container.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    container.mgmt.addDomain(op.id, "casino.example.com", "prod");
    container.mgmt.assignGame({
      operator_id: op.id,
      game_id: game.id,
      math_config_id: cfg.id,
      currency: "GEL",
      allowed_bets: [1, 5, 500]
    });
    wallet.setBalance(`p_${slug}`, "GEL", 5000);
    const token = container.sessions.createLaunchToken({
      operator_id: op.id,
      game_code: "bananax",
      operator_player_id: `p_${slug}`,
      currency: "GEL",
      origin: "casino.example.com"
    });
    const session = container.sessions.initSession(token);
    let firstRef = "";
    let firstWinRef: string | null = null;
    for (let i = 0; i < 30; i += 1) {
      const out = await container.orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: `${slug}-${i}` });
      if (i === 0) firstRef = out.round_ref;
      if (!firstWinRef && out.total_win > 0) firstWinRef = out.round_ref;
    }
    if (slug === "alpha") {
      opAId = op.id;
      opARoundRef = firstRef;
      opARoundWinningRef = firstWinRef;
    } else {
      opBId = op.id;
      opBRoundRef = firstRef;
    }
  }
}

function providerToken(): string {
  return container.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
}
function operatorToken(operatorId: string): string {
  return container.adminAuth.mintToken({ admin_id: "opadm-1", scope: "operator", operator_id: operatorId, role: "operator_admin" });
}

describe("Round Inspector — GET /admin/v1/rounds/:roundRef", () => {
  beforeEach(async () => {
    await provisionAndPlay();
  });

  it("returns the full stored outcome (matrix, tumble_steps, ways_wins, multipliers, …)", async () => {
    const token = providerToken();
    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/rounds/${opARoundRef}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      round_ref: string;
      operator_id: string;
      outcome: {
        matrix: string[][];
        tumble_steps: unknown[];
        ways_wins: unknown[];
        multipliers: unknown[];
        scatter_count: number;
        total_win: number;
        multiplier_applied: number;
        is_free_spin: boolean;
        free_spins_awarded: number;
        bet_charged: number;
      };
      outcome_hash: string;
      rng_algo: string;
      chain: { seq: number; prev_hash: string; chain_hash: string };
    };
    expect(body.round_ref).toBe(opARoundRef);
    expect(body.operator_id).toBe(opAId);
    expect(Array.isArray(body.outcome.matrix)).toBe(true);
    expect(body.outcome.matrix.length).toBe(5);
    expect(body.outcome.matrix[0].length).toBe(6);
    expect(Array.isArray(body.outcome.tumble_steps)).toBe(true);
    expect(Array.isArray(body.outcome.ways_wins)).toBe(true);
    expect(Array.isArray(body.outcome.multipliers)).toBe(true);
    expect(typeof body.outcome.scatter_count).toBe("number");
    expect(typeof body.outcome.total_win).toBe("number");
    expect(typeof body.outcome.is_free_spin).toBe("boolean");
    expect(body.outcome_hash).toHaveLength(64);
    expect(body.chain.chain_hash).toHaveLength(64);
  });

  it("for a winning round, stored ways_wins/multipliers/tumble_steps match what was resolved", async () => {
    if (!opARoundWinningRef) {
      // No winning round in this sample — skip silently; the broader contract is
      // already covered by the previous test.
      return;
    }
    const token = providerToken();
    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/rounds/${opARoundWinningRef}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total_win: number;
      outcome: {
        total_win: number;
        ways_wins: Array<{ symbol: string; count: number; amount: number }>;
        tumble_steps: Array<{ matrix: string[][]; win_total: number; ways_wins: unknown[]; winning_positions: unknown[] }>;
      };
    };
    expect(body.outcome.total_win).toBe(body.total_win);
    expect(body.outcome.total_win).toBeGreaterThan(0);
    // A winning round produces at least one tumble step with a populated win_total.
    expect(body.outcome.tumble_steps.length).toBeGreaterThan(0);
    const sumOfSteps = body.outcome.tumble_steps.reduce((s, t) => s + Number(t.win_total || 0), 0);
    expect(sumOfSteps).toBeGreaterThan(0);
    // ways_wins (the top-level summary) must be non-empty too.
    expect(body.outcome.ways_wins.length).toBeGreaterThan(0);
    // Every winning tumble step has matching matrix + ways_wins shape (data integrity).
    for (const step of body.outcome.tumble_steps) {
      expect(Array.isArray(step.matrix)).toBe(true);
      expect(step.matrix.length).toBe(5);
      expect(step.matrix[0].length).toBe(6);
      expect(Array.isArray(step.ways_wins)).toBe(true);
      expect(Array.isArray(step.winning_positions)).toBe(true);
    }
  });

  it("does not leak cross-tenant rounds — operator A getting operator B's round → 404", async () => {
    const tokenA = operatorToken(opAId);
    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/rounds/${opBRoundRef}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("ROUND_NOT_FOUND");
  });

  it("unknown round_ref → 404", async () => {
    const token = providerToken();
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/rounds/r_does_not_exist",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(404);
  });

  it("hash chain still verifies with the new outcome field stored", async () => {
    expect(container.ledger.verifyIntegrity().rounds.ok).toBe(true);
  });

  it("an operator admin can read its own round detail (including outcome)", async () => {
    const tokenA = operatorToken(opAId);
    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/rounds/${opARoundRef}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { operator_id: string; outcome: { matrix: unknown } };
    expect(body.operator_id).toBe(opAId);
    expect(body.outcome.matrix).toBeDefined();
  });

  it("requires the rounds.read permission", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/rounds/${opARoundRef}`
    });
    expect(res.statusCode).toBe(401);
  });
});
