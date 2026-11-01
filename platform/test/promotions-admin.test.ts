import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { startPromotionsJob } from "../src/jobs/promotions";
import type { CreditArgs } from "../src/modules/wallet/wallet.types";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const logger = createLogger({ level: "silent", pretty: false, env: "test" });

let app: FastifyInstance;
let c: Container;
let wallet: SandboxWallet;
let opA: string;
let opB: string;
let failCredits = false;

async function setup(): Promise<void> {
  failCredits = false;
  wallet = new SandboxWallet({ failCreditFor: (a: CreditArgs) => failCredits && a.txType === "PROMO_WIN" });
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger, container: c, promotionsIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  for (const slug of ["a", "b"]) {
    const op = c.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
    if (slug === "a") opA = op.id; else opB = op.id;
  }
}

let n = 0;
async function play(op: string, player: string, spins: number, bet: number) {
  wallet.setBalance(player, "GEL", 10_000);
  const lt = c.sessions.createLaunchToken({ operator_id: op, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
  const s = c.sessions.initSession(lt);
  // `spins` PAID rounds: a bonus the engine triggers plays its free spins (no stake) in between.
  for (let paid = 0; paid < spins; ) {
    const free = c.sessions.get(s.id).free_spins_left > 0;
    await c.orchestrator.spin(s.id, { bet_amount: bet, idempotency_key: `h${n++}` });
    if (!free) paid++;
  }
}
const operator = (id: string) => c.adminAuth.mintToken({ admin_id: "op-admin", scope: "operator", operator_id: id, role: "operator_admin" });
const provider = () => c.adminAuth.mintToken({ admin_id: "prov", scope: "provider", role: "provider_super_admin" });
const req = (method: "GET" | "POST", url: string, token: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...(payload ? { "content-type": "application/json" } : {}) }, payload: payload ? JSON.stringify(payload) : undefined });
const window = () => ({ starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString() });
const job = (random?: (n: number) => number) => startPromotionsJob({ promotions: c.promotions, payouts: c.promoPayouts, history: c.history, persistence: c.persistence, logger, intervalMs: 0, graceMs: 0, now: () => new Date(Date.now() + 120_000), random });
const race = { name: "Weekend race", game_codes: ["bananax"], currency: "GEL", metric: "turnover", prizes: [100, 50] };

describe("Promotions admin API", () => {
  beforeEach(setup);

  it("creates tournaments: scope, games and validation", async () => {
    expect((await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), game_codes: ["classic-5x3"] })).json().error.code).toBe("GAME_NOT_ASSIGNED");
    expect((await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), currency: "EUR" })).json().error.code).toBe("GAME_NOT_ASSIGNED");
    const bad = await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), prizes: [] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe("PROMO_PRIZES_INVALID");
    expect((await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), metric: "luck" })).json().error.code).toBe("TOURNAMENT_METRIC_INVALID");
    expect((await req("POST", "/admin/v1/tournaments", provider(), { ...race, ...window() })).json().error.message).toBe("operator_id required");
    const viewer = c.adminAuth.mintToken({ admin_id: "v", scope: "operator", operator_id: opA, role: "operator_viewer" });
    expect((await req("POST", "/admin/v1/tournaments", viewer, { ...race, ...window() })).statusCode).toBe(403);
    expect((await req("GET", "/admin/v1/tournaments", viewer)).statusCode).toBe(200);
    const res = await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), operator_id: opB }); // pinned to A
    expect(res.statusCode).toBe(201);
    expect(res.json().tournament).toMatchObject({ operator_id: opA, state: "running", prize_pool: 150, places: 2, winners: 0 });
    expect((await req("GET", "/admin/v1/tournaments", operator(opB))).json().count).toBe(0);
    expect((await req("GET", "/admin/v1/tournaments", provider())).json().count).toBe(1);
  });

  it("a tournament's live board, then its prizes once closed; cancel rules", async () => {
    const t = (await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window() })).json().tournament;
    const gone = (await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), name: "Cancelled" })).json().tournament;
    expect((await req("POST", `/admin/v1/tournaments/${gone.id}/cancel`, operator(opA))).json()).toMatchObject({ tournament: { state: "cancelled" }, already_cancelled: false });
    expect((await req("POST", `/admin/v1/tournaments/${gone.id}/cancel`, operator(opA))).json().already_cancelled).toBe(true);
    await play(opA, "p1", 4, 5);
    await play(opA, "p2", 2, 5);
    const live = (await req("GET", `/admin/v1/tournaments/${t.id}`, operator(opA))).json();
    expect(live.board.map((r: { operator_player_id: string; score: number }) => [r.operator_player_id, r.score])).toEqual([["p1", 20], ["p2", 10]]);
    expect((await req("GET", `/admin/v1/tournaments/${t.id}`, operator(opB))).statusCode).toBe(404);
    await job().runOnce();
    const closed = (await req("GET", `/admin/v1/tournaments/${t.id}`, operator(opA))).json();
    expect(closed.tournament).toMatchObject({ state: "closed", winners: 2, paid: 150 });
    expect(closed.board.map((r: { rank: number; operator_player_id: string }) => [r.rank, r.operator_player_id])).toEqual([[1, "p1"], [2, "p2"]]);
    expect((await req("POST", `/admin/v1/tournaments/${t.id}/cancel`, operator(opA))).statusCode).toBe(409);
  });

  it("prize drops: create, list, detail with prizes, cancel", async () => {
    const body = { name: "Gold rain", game_codes: ["bananax"], currency: "GEL", odds: 1, prizes: [{ amount: 10, count: 2 }], ...window() };
    expect((await req("POST", "/admin/v1/prize-drops", operator(opA), { ...body, odds: 0 })).json().error.code).toBe("PRIZE_DROP_ODDS_INVALID");
    const d = (await req("POST", "/admin/v1/prize-drops", operator(opA), body));
    expect(d.statusCode).toBe(201);
    const drop = d.json().prize_drop;
    expect(drop).toMatchObject({ state: "running", prize_pool: 20, prizes_total: 2, prizes_left: 2 });
    await play(opA, "p1", 3, 5);
    await job(() => 0).runOnce();
    const detail = (await req("GET", `/admin/v1/prize-drops/${drop.id}`, operator(opA))).json();
    expect(detail.prize_drop).toMatchObject({ state: "closed", winners: 2, paid: 20, prizes_left: 0 });
    expect(detail.wins.every((w: { round_ref: string; status: string }) => w.round_ref && w.status === "paid")).toBe(true);
    expect((await req("POST", `/admin/v1/prize-drops/${drop.id}/cancel`, operator(opA))).statusCode).toBe(409);
    const other = (await req("POST", "/admin/v1/prize-drops", operator(opA), body)).json().prize_drop;
    expect((await req("POST", `/admin/v1/prize-drops/${other.id}/cancel`, operator(opB))).statusCode).toBe(404);
    expect((await req("POST", `/admin/v1/prize-drops/${other.id}/cancel`, operator(opA))).json().prize_drop.state).toBe("cancelled");
    expect((await req("GET", "/admin/v1/prize-drops", operator(opA))).json().count).toBe(2);
  });

  it("Promo Win Search filters and totals; a failed prize can be retried by hand, once", async () => {
    await req("POST", "/admin/v1/tournaments", operator(opA), { ...race, ...window(), prizes: [20, 10] });
    await play(opA, "p1", 4, 5);
    await play(opA, "p2", 2, 5);
    failCredits = true;
    await job().runOnce();
    const failed = (await req("GET", "/admin/v1/promo-wins?status=failed", operator(opA))).json();
    expect(failed.total).toBe(2);
    expect(failed.totals).toEqual([{ currency: "GEL", amount: 30 }]);
    expect((await req("GET", "/admin/v1/promo-wins?player=p2", operator(opA))).json().wins.map((w: { amount: number }) => w.amount)).toEqual([10]);
    expect((await req("GET", "/admin/v1/promo-wins?type=prize_drop", operator(opA))).json().total).toBe(0);
    expect((await req("GET", "/admin/v1/promo-wins", operator(opB))).json().total).toBe(0);
    expect((await req("GET", "/admin/v1/promo-wins?status=lost", operator(opA))).statusCode).toBe(422);
    expect((await req("GET", "/admin/v1/promo-wins?from=yesterday", operator(opA))).statusCode).toBe(422);
    failCredits = false;
    const w = failed.wins.find((x: { operator_player_id: string }) => x.operator_player_id === "p2");
    expect((await req("POST", `/admin/v1/promo-wins/${w.id}/retry`, operator(opB))).statusCode).toBe(404);
    expect((await req("POST", `/admin/v1/promo-wins/${w.id}/retry`, operator(opA))).json()).toMatchObject({ result: "paid", win: { status: "paid" } });
    expect((await req("POST", `/admin/v1/promo-wins/${w.id}/retry`, operator(opA))).json().result).toBe("paid");
    expect(c.transactions.list({ type: "PROMO_WIN" }).filter((t) => t.amount === 10)).toHaveLength(1);
  });
});
