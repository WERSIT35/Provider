import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { periodStart } from "../src/modules/reporting/business-report";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };

let app: FastifyInstance;
let c: Container;
let opAId: string;
let opBId: string;

/** Operator A: p1 6 spins @1 (two sessions), p2 3 spins @5; operator B: p1 4 spins @1. */
async function setup(): Promise<void> {
  const wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  const plan: Record<string, Array<[string, number, number]>> = { a: [["p1", 3, 1], ["p1", 3, 1], ["p2", 3, 5]], b: [["p1", 4, 1]] };
  for (const slug of ["a", "b"]) {
    const op = c.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
    let n = 0;
    for (const [player, spins, bet] of plan[slug]) {
      wallet.setBalance(player, "GEL", 10_000);
      const token = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
      const session = c.sessions.initSession(token);
      for (let i = 0; i < spins; i += 1) await c.orchestrator.spin(session.id, { bet_amount: bet, idempotency_key: `${slug}-${n++}` });
    }
    if (slug === "a") opAId = op.id; else opBId = op.id;
  }
}

const providerToken = () => c.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
const operatorToken = (id: string) => c.adminAuth.mintToken({ admin_id: "op-1", scope: "operator", operator_id: id, role: "operator_admin" });
const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

describe("Business reports", () => {
  beforeEach(setup);

  it("Business Summary: one row per day, matching the rounds summary", async () => {
    const res = await get("/admin/v1/reports/business?period=day", operatorToken(opAId));
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.rows).toHaveLength(1);
    const row = d.rows[0];
    const s = c.reporting.roundsSummary(opAId);
    expect(row.currency).toBe("GEL");
    expect(row.rounds).toBe(s.rounds);
    expect(row.bets_real).toBeCloseTo(s.total_bet, 2);
    expect(row.wins_real).toBeCloseTo(s.total_win, 2);
    expect(row.margin).toBeCloseTo(s.ggr, 2);
    expect(row.new_players).toBe(2);
    expect(row.play_sessions).toBe(3);
    expect(row.free_rounds).toBe(0);
    expect(d.totals).toEqual([{ ...row, period: null }]);
  });

  it("is tenant-scoped; a provider sees every operator", async () => {
    const a = (await get(`/admin/v1/reports/business?period=total&operator_id=${opBId}`, operatorToken(opAId))).json();
    expect(a.operator_id).toBe(opAId);
    expect(a.rows[0].rounds).toBe(9);
    const all = (await get("/admin/v1/reports/business?period=total", providerToken())).json();
    expect(all.rows[0].rounds).toBe(13);
    expect(all.rows[0].new_players).toBe(3); // p1 at A and p1 at B are different players
    const b = (await get(`/admin/v1/reports/business?period=total&operator_id=${opBId}`, providerToken())).json();
    expect(b.rows[0].rounds).toBe(4);
  });

  it("Games Profit and Member Business Summary group by game and player", async () => {
    const games = (await get("/admin/v1/reports/business?period=total&by=game", operatorToken(opAId))).json();
    expect(games.rows.map((r: { game_code: string }) => r.game_code)).toEqual(["bananax"]);
    const members = (await get("/admin/v1/reports/business?period=total&by=player", operatorToken(opAId))).json();
    const p1 = members.rows.find((r: { operator_player_id: string }) => r.operator_player_id === "p1");
    const p2 = members.rows.find((r: { operator_player_id: string }) => r.operator_player_id === "p2");
    expect(p1.rounds).toBe(6);
    expect(p1.play_sessions).toBe(2);
    expect(p2.rounds).toBe(3);
    expect(p2.bets_real).toBe(15);
    // Biggest turnover first.
    expect(members.rows[0].operator_player_id).toBe("p2");
    const one = (await get("/admin/v1/reports/business?period=day&by=player&player=p2", operatorToken(opAId))).json();
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0].operator_player_id).toBe("p2");
  });

  it("a date range outside the play is empty; voided rounds are left out", async () => {
    const empty = (await get("/admin/v1/reports/business?from=2000-01-01&to=2000-01-02", operatorToken(opAId))).json();
    expect(empty.rows).toEqual([]);
    const ref = c.reporting.listRounds(opAId)[0].round_ref;
    await c.lifecycle.voidRound(ref, "prov-1", "test");
    const d = (await get("/admin/v1/reports/business?period=total", operatorToken(opAId))).json();
    expect(d.rows[0].rounds).toBe(8);
  });

  it("validates its query", async () => {
    for (const q of ["period=hour", "by=country", "tz=1000", "tz=1.5", "from=yesterday", "limit=0"]) {
      expect((await get(`/admin/v1/reports/business?${q}`, operatorToken(opAId))).statusCode).toBe(422);
    }
    const viewer = c.adminAuth.mintToken({ admin_id: "x", scope: "operator", operator_id: opAId, role: "operator_viewer" });
    expect((await get("/admin/v1/reports/business", viewer)).statusCode).toBe(200);
  });
});

describe("periodStart", () => {
  it("cuts periods in the asked time zone; weeks start on Monday", () => {
    // 2026-11-01 21:30 UTC is already 2 Nov in Tbilisi (UTC+4).
    expect(periodStart("2026-11-01T21:30:00.000Z", "day", 0)).toBe("2026-11-01");
    expect(periodStart("2026-11-01T21:30:00.000Z", "day", 240)).toBe("2026-11-02");
    expect(periodStart("2026-11-01T10:00:00.000Z", "week", 0)).toBe("2026-10-26"); // Sunday → Monday before
    expect(periodStart("2026-11-02T10:00:00.000Z", "week", 0)).toBe("2026-11-02");
    expect(periodStart("2026-11-15T10:00:00.000Z", "month", 0)).toBe("2026-11-01");
    expect(periodStart("2026-11-15T10:00:00.000Z", "year", 0)).toBe("2026-01-01");
    expect(periodStart("2026-11-15T10:00:00.000Z", "total", 0)).toBeNull();
  });
});
