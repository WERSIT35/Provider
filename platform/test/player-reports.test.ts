import { describe, it, expect, beforeEach } from "vitest";
import vm from "node:vm";
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
let c: Container;
let opAId: string;
let opBId: string;

/** Two operators; operator A has players p1 (6 spins @1) and p2 (3 spins @5); B has p1 (4 spins @1). */
async function setup(): Promise<void> {
  const wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();

  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");

  const plan: Record<string, Array<[string, number, number]>> = { a: [["p1", 6, 1], ["p2", 3, 5]], b: [["p1", 4, 1]] };
  for (const slug of ["a", "b"]) {
    const op = c.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
    for (const [player, spins, bet] of plan[slug]) {
      // Sandbox wallet balances are keyed by player id only, so give each a fresh pot.
      wallet.setBalance(player, "GEL", 10_000);
      const token = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
      const session = c.sessions.initSession(token);
      for (let i = 0; i < spins; i += 1) {
        await c.orchestrator.spin(session.id, { bet_amount: bet, idempotency_key: `${slug}-${player}-${i}` });
      }
    }
    if (slug === "a") opAId = op.id;
    else opBId = op.id;
  }
}

const providerToken = () => c.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
const operatorToken = (operatorId: string, role: "operator_admin" | "operator_viewer" = "operator_admin") =>
  c.adminAuth.mintToken({ admin_id: "opadm-1", scope: "operator", operator_id: operatorId, role });

async function get(url: string, token: string) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
}

describe("Player Reports", () => {
  beforeEach(setup);

  it("aggregates per player and matches the operator's rounds summary", () => {
    const report = c.reporting.playerReport(opAId);
    expect(report.total_players).toBe(2);
    // Default sort: turnover, descending.
    expect(report.players[0].total_bet).toBeGreaterThanOrEqual(report.players[1].total_bet);
    expect(report.players.find((p) => p.operator_player_id === "p1")!.rounds).toBe(6);
    expect(report.players.find((p) => p.operator_player_id === "p2")!.rounds).toBe(3);

    const summary = c.reporting.roundsSummary(opAId);
    const sum = (k: "rounds" | "total_bet" | "total_win") => report.players.reduce((s, p) => s + p[k], 0);
    expect(sum("rounds")).toBe(summary.rounds);
    expect(sum("total_bet")).toBeCloseTo(summary.total_bet, 2);
    expect(sum("total_win")).toBeCloseTo(summary.total_win, 2);
    for (const p of report.players) {
      expect(p.ggr).toBeCloseTo(p.total_bet - p.total_win, 2);
      expect(p.first_seen <= p.last_seen).toBe(true);
    }
  });

  it("keeps same-named players of different operators apart in provider scope", () => {
    const report = c.reporting.playerReport();
    expect(report.total_players).toBe(3);
    expect(report.players.filter((p) => p.operator_player_id === "p1").map((p) => p.operator_id).sort()).toEqual([opAId, opBId].sort());
  });

  it("excludes voided rounds from totals but counts them in the summary", async () => {
    const before = c.reporting.playerSummary(opAId, "p1")!;
    const round = c.reporting.listRoundsByPlayer(opAId, "p1")[0];
    await c.lifecycle.voidRound(round.round_ref, "admin-1", "test");

    const after = c.reporting.playerSummary(opAId, "p1")!;
    expect(after.rounds).toBe(before.rounds - 1);
    expect(after.voided_rounds).toBe(1);
    expect(after.total_bet).toBeCloseTo(before.total_bet - round.bet_charged, 2);
    expect(after.last_seen).toBe(before.last_seen);
    expect(c.reporting.playerReport(opAId).players.find((p) => p.operator_player_id === "p1")!.rounds).toBe(after.rounds);
  });

  it("applies sort, limit, date range and game filters", () => {
    expect(c.reporting.playerReport(opAId, { sort: "rounds" }).players[0].operator_player_id).toBe("p1");
    const limited = c.reporting.playerReport(opAId, { limit: 1 });
    expect(limited.count).toBe(1);
    expect(limited.total_players).toBe(2);
    expect(c.reporting.playerReport(opAId, { to: "2000-01-01" }).total_players).toBe(0);
    expect(c.reporting.playerReport(opAId, { game_id: "no-such-game" }).total_players).toBe(0);
    expect(c.reporting.playerSummary(opAId, "nobody")).toBeNull();
  });

  it("GET /admin/v1/reports/players is tenant-scoped for operator admins", async () => {
    // An operator cannot widen its scope by passing another operator_id.
    const res = await get(`/admin/v1/reports/players?operator_id=${opBId}`, operatorToken(opAId));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { operator_id: string; players: Array<{ operator_id: string }>; total_players: number };
    expect(body.operator_id).toBe(opAId);
    expect(body.total_players).toBe(2);
    expect(body.players.every((p) => p.operator_id === opAId)).toBe(true);

    const all = await get("/admin/v1/reports/players", providerToken());
    expect((all.json() as { total_players: number }).total_players).toBe(3);

    // Viewer role has reports.read.
    expect((await get("/admin/v1/reports/players", operatorToken(opAId, "operator_viewer"))).statusCode).toBe(200);
  });

  it("validates sort, limit and game", async () => {
    const t = operatorToken(opAId);
    expect((await get("/admin/v1/reports/players?sort=bogus", t)).statusCode).toBe(422);
    expect((await get("/admin/v1/reports/players?limit=0", t)).statusCode).toBe(422);
    expect((await get("/admin/v1/reports/players?game=nope", t)).statusCode).toBe(422);
    const byCode = await get("/admin/v1/reports/players?game=bananax&sort=ggr&limit=5", t);
    expect(byCode.statusCode).toBe(200);
    expect((byCode.json() as { total_players: number }).total_players).toBe(2);
  });

  it("GET /admin/v1/players/:id/summary never leaks other tenants", async () => {
    const own = await get("/admin/v1/players/p2/summary", operatorToken(opAId));
    expect(own.statusCode).toBe(200);
    expect((own.json() as { rounds: number }).rounds).toBe(3);

    // p2 exists only under A; operator B asking for it (even naming A) gets 404.
    const cross = await get(`/admin/v1/players/p2/summary?operator_id=${opAId}`, operatorToken(opBId));
    expect(cross.statusCode).toBe(404);

    expect((await get("/admin/v1/players/p1/summary", providerToken())).statusCode).toBe(422); // provider must name an operator
    expect((await get(`/admin/v1/players/p1/summary?operator_id=${opBId}`, providerToken())).statusCode).toBe(200);
  });

  it("serves a console script that parses and both portals expose Player Reports", async () => {
    const js = await app.inject({ method: "GET", url: "/console/app.js" });
    expect(js.statusCode).toBe(200);
    expect(() => new vm.Script(js.body)).not.toThrow();
    expect(js.body).toContain("function loadPlayerReport");
    expect(js.body).toContain("/^#inspector\\?(.*)$/");

    const operator = await app.inject({ method: "GET", url: "/admin" });
    expect(operator.body).toContain('id="playerReportsView"');
    // Round Inspector leads the operator nav.
    expect(operator.body.indexOf('data-view="inspector"')).toBeLessThan(operator.body.indexOf('data-view="dashboard"'));
    const provider = await app.inject({ method: "GET", url: "/provider" });
    expect(provider.body).toContain('id="playerReportsView"');
  });
});
