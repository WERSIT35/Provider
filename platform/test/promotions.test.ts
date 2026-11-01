import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { startPromotionsJob } from "../src/jobs/promotions";
import { rankBoard } from "../src/modules/promotions/tournament-board";
import type { CreatePrizeDropInput, CreateTournamentInput } from "../src/modules/promotions/promotions";
import type { CreditArgs } from "../src/modules/wallet/wallet.types";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const logger = createLogger({ level: "silent", pretty: false, env: "test" });

let c: Container;
let wallet: SandboxWallet;
let opA: string;
let opB: string;
let failCredits = false;

async function setup(): Promise<void> {
  failCredits = false;
  wallet = new SandboxWallet({ failCreditFor: (a: CreditArgs) => failCredits && a.txType === "PROMO_WIN" });
  c = buildContainer(CONFIG, { wallet });
  await buildApp({ logger, container: c, promotionsIntervalMs: 0 }).ready();
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
    await c.orchestrator.spin(s.id, { bet_amount: bet, idempotency_key: `k${n++}` });
    if (!free) paid++;
  }
}
const balance = async (player: string) => (await wallet.balance({ operatorId: opA }, { operatorPlayerId: player, currency: "GEL" })).amount;
const tournament = (over: Partial<CreateTournamentInput> = {}) => c.promotions.createTournament({
  operator_id: opA, name: "Race", game_codes: ["bananax"], currency: "GEL", metric: "turnover", prizes: [40], created_by: "x",
  starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString(), ...over
});
const job = (opts: { afterMs?: number; random?: (n: number) => number } = {}) => startPromotionsJob({ promotions: c.promotions, payouts: c.promoPayouts, history: c.history, persistence: c.persistence, logger, intervalMs: 0, graceMs: 0, now: () => new Date(Date.now() + (opts.afterMs ?? 120_000)), random: opts.random });
const drop = (over: Partial<CreatePrizeDropInput> = {}) => c.promotions.createPrizeDrop({
  operator_id: opA, name: "Drops", game_codes: ["bananax"], currency: "GEL", odds: 1, prizes: [{ amount: 10, count: 2 }, { amount: 5, count: 1 }], created_by: "x",
  starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 3600_000).toISOString(), ...over
});

describe("Tournaments", () => {
  beforeEach(setup);

  it("validates what it creates", () => {
    for (const bad of [{ prizes: [] }, { prizes: [10.001] }, { prizes: [-1] }, { prizes: Array(501).fill(1) }, { metric: "luck" as never }, { name: " " }, { currency: "lari" },
      { game_codes: [] }, { min_bet: -1 }, { ends_at: new Date(Date.now() - 1000).toISOString() }, { starts_at: "soon" }]) {
      expect(() => tournament(bad)).toThrow();
    }
    expect(tournament({ currency: "gel", game_codes: ["bananax", "bananax"] })).toMatchObject({ currency: "GEL", game_codes: ["bananax"], status: "open", min_bet: 0 });
  });

  it("ranks from the rounds, closes after the window and pays each rank once", async () => {
    const t = tournament({ min_bet: 1, prizes: [100, 50, 25] });
    await play(opA, "big", 6, 5);   // 30 turnover
    await play(opA, "mid", 10, 1);  // 10
    await play(opA, "small", 3, 1); // 3
    await play(opA, "tiny", 1, 1);  // 1 — no prize left for 4th
    await play(opB, "other", 50, 5); // another operator's player never counts
    const live = await c.history.tournamentBoard(t, 10);
    expect(live.map((r) => [r.operator_player_id, r.score])).toEqual([["big", 30], ["mid", 10], ["small", 3], ["tiny", 1]]);

    const before = await balance("big");
    expect(await job().runOnce()).toMatchObject({ closed: 1, paid: 3, failed: 0 });
    expect(Number(((await balance("big")) - before).toFixed(2))).toBe(100);
    expect(c.promotions.getTournament(t.id)).toMatchObject({ status: "closed" });
    expect(c.promotions.listWins({ promo_id: t.id }).sort((a, b) => a.rank! - b.rank!).map((w) => [w.rank, w.operator_player_id, w.amount, w.status]))
      .toEqual([[1, "big", 100, "paid"], [2, "mid", 50, "paid"], [3, "small", 25, "paid"]]);
    // Ledger: one PROMO_WIN per prize; round-vs-wallet reconciliation is untouched.
    expect(c.transactions.list({ operator_id: opA, type: "PROMO_WIN" }).map((x) => x.amount).sort((a, b) => b - a)).toEqual([100, 50, 25]);
    expect(c.reporting.reconcile(opA).ok).toBe(true);
    // Running again pays nothing more.
    expect(await job().runOnce()).toMatchObject({ closed: 0, paid: 0 });
    expect(c.transactions.list({ type: "PROMO_WIN" })).toHaveLength(3);
  });

  it("an open window is not closed; a cancelled tournament pays nothing", async () => {
    const open = tournament({ ends_at: new Date(Date.now() + 3600_000).toISOString() });
    const cancelled = tournament();
    await play(opA, "p1", 3, 5);
    expect(c.promotions.cancelTournament(cancelled.id).status).toBe("cancelled");
    expect(await job().runOnce()).toMatchObject({ closed: 0, paid: 0 });
    expect(c.promotions.getTournament(open.id)?.status).toBe("open");
    expect(c.promotions.listWins()).toEqual([]);
  });

  it("best multiplier: small stakes and voided rounds don't count", async () => {
    const t = tournament({ metric: "max_multiplier", min_bet: 5, prizes: [10] });
    await play(opA, "low", 30, 1);
    await play(opA, "high", 20, 5);
    const board = await c.history.tournamentBoard(t, 10);
    expect(board.every((r) => r.operator_player_id === "high")).toBe(true);
    const counted = c.reporting.listRounds(opA).filter((r) => r.operator_player_id === "high");
    const mult = (r: { total_win: number; bet_amount: number }) => Number((r.total_win / r.bet_amount).toFixed(4));
    const best = Math.max(...counted.map(mult));
    if (best > 0) {
      expect(board[0].score).toBe(best);
      for (const r of counted.filter((x) => mult(x) === best)) await c.lifecycle.voidRound(r.round_ref, "prov", "test");
      expect((await c.history.tournamentBoard(t, 10))[0]?.score ?? 0).toBeLessThan(best);
    }
  });

  it("a credit that fails stays owed and is paid once on a later run", async () => {
    tournament();
    await play(opA, "p1", 3, 5);
    failCredits = true;
    expect(await job().runOnce()).toMatchObject({ closed: 1, paid: 0, failed: 1 });
    const [w] = c.promotions.listWins({ operator_id: opA });
    expect(w).toMatchObject({ status: "failed", error_code: "CREDIT_OUTCOME_UNKNOWN", attempts: 1 });
    expect(c.transactions.list({ type: "PROMO_WIN" })).toHaveLength(0);
    failCredits = false;
    const before = await balance("p1");
    expect(await job().runOnce()).toMatchObject({ paid: 1, failed: 0 });
    expect(await job().runOnce()).toMatchObject({ paid: 0, failed: 0 });
    expect(Number(((await balance("p1")) - before).toFixed(2))).toBe(40);
    expect(c.promotions.getWin(w.id)).toMatchObject({ status: "paid", attempts: 2 });
  });

  it("a credit applied whose answer was lost is never paid twice (same key replays)", async () => {
    tournament();
    await play(opA, "p1", 3, 5);
    const real = wallet.credit.bind(wallet);
    let lose = true;
    wallet.credit = async (ctx, args) => { const r = await real(ctx, args); if (lose && args.txType === "PROMO_WIN") { lose = false; throw new Error("socket hang up"); } return r; };
    const before = await balance("p1");
    expect(await job().runOnce()).toMatchObject({ failed: 1 });
    expect(await job().runOnce()).toMatchObject({ paid: 1 });
    expect(Number(((await balance("p1")) - before).toFixed(2))).toBe(40);
    expect(c.transactions.list({ type: "PROMO_WIN" })).toHaveLength(1);
  });

  it("a prize credit must name its promotion", async () => {
    await expect(wallet.credit({ operatorId: opA }, { idempotencyKey: "x", roundRef: "promo_x", operatorPlayerId: "p", amount: 5, currency: "GEL", txType: "PROMO_WIN" })).rejects.toThrow("PROMO_WIN_INVALID");
  });
});

describe("Prize Drops", () => {
  beforeEach(setup);

  it("validates; tiers of the same amount merge", () => {
    for (const bad of [{ odds: 0 }, { odds: 1.5 }, { prizes: [] }, { prizes: [{ amount: 0, count: 1 }] }, { prizes: [{ amount: 5, count: 0 }] }, { prizes: [{ amount: 5, count: 501 }] }]) {
      expect(() => drop(bad)).toThrow();
    }
    expect(drop({ prizes: [{ amount: 5, count: 1 }, { amount: 10, count: 1 }, { amount: 5, count: 2 }] })).toMatchObject({ prizes: [{ amount: 10, count: 1 }, { amount: 5, count: 3 }], prizes_left: 4, cursor_seq: -1 });
  });

  it("drops on qualifying rounds in ledger order until the prizes are gone, and pays them", async () => {
    const d = drop({ min_bet: 5 });
    await play(opA, "small", 5, 1);  // below min_bet
    await play(opB, "other", 5, 5);  // another operator
    await play(opA, "p1", 2, 5);
    await play(opA, "p2", 3, 5);
    const qualifying = c.reporting.listRounds(opA).filter((r) => r.bet_amount >= 5).sort((a, b) => a.seq - b.seq);
    const before = { p1: await balance("p1"), p2: await balance("p2") };
    expect(await job({ afterMs: 0, random: () => 0 }).runOnce()).toMatchObject({ paid: 3 });
    const wins = c.promotions.listWins({ promo_id: d.id }).sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(wins.map((w) => w.round_ref).sort()).toEqual(qualifying.slice(0, 3).map((r) => r.round_ref).sort());
    expect(wins.map((w) => w.amount).sort((a, b) => b - a)).toEqual([10, 10, 5]);
    expect(c.promotions.getPrizeDrop(d.id)).toMatchObject({ status: "closed", prizes_left: 0 });
    const paid = Number(((await balance("p1")) - before.p1 + (await balance("p2")) - before.p2).toFixed(2));
    expect(paid).toBe(25);
    expect(c.reporting.reconcile(opA).ok).toBe(true);
    expect(await job({ afterMs: 0, random: () => 0 }).runOnce()).toMatchObject({ paid: 0 });
  });

  it("long odds drop nothing; the cursor moves on; the drop closes when its window ends", async () => {
    const d = drop({ odds: 1_000_000 });
    await play(opA, "p1", 4, 5);
    expect(await job({ afterMs: 0, random: () => 1 }).runOnce()).toMatchObject({ paid: 0 });
    const tip = Math.max(...c.reporting.listRounds(opA).map((r) => r.seq));
    expect(c.promotions.getPrizeDrop(d.id)).toMatchObject({ status: "open", cursor_seq: tip, prizes_left: 3 });
    // Rounds already examined are never drawn again, even with a sure win now.
    expect(await job({ afterMs: 0, random: () => 0 }).runOnce()).toMatchObject({ paid: 0 });
    await play(opA, "p2", 1, 5);
    expect(await job({ afterMs: 0, random: () => 0 }).runOnce()).toMatchObject({ paid: 1 });
    expect(c.promotions.listWins({ promo_id: d.id })[0].operator_player_id).toBe("p2");
    await job({ afterMs: 7200_000, random: () => 1 }).runOnce();
    expect(c.promotions.getPrizeDrop(d.id)?.status).toBe("closed");
  });

  it("a cancelled drop draws nothing", async () => {
    const d = drop();
    c.promotions.cancelPrizeDrop(d.id);
    await play(opA, "p1", 3, 5);
    expect(await job({ afterMs: 0, random: () => 0 }).runOnce()).toMatchObject({ paid: 0 });
    expect(c.promotions.getPrizeDrop(d.id)?.status).toBe("cancelled");
  });
});

describe("rankBoard", () => {
  it("ties go to whoever got there first, then the player id; zero never ranks", () => {
    const r = (p: string, t: string, bet: number, win: number) => ({ operator_player_id: p, created_at: t, bet_amount: bet, bet_charged: bet, total_win: win });
    const rounds = [r("b", "2026-01-01T00:00:02Z", 1, 10), r("a", "2026-01-01T00:00:03Z", 1, 10), r("c", "2026-01-01T00:00:01Z", 2, 20), r("z", "2026-01-01T00:00:01Z", 1, 0)];
    expect(rankBoard("max_multiplier", rounds, 10).map((x) => x.operator_player_id)).toEqual(["c", "b", "a"]);
    expect(rankBoard("total_win", rounds, 2).map((x) => [x.operator_player_id, x.score])).toEqual([["c", 20], ["b", 10]]);
    expect(rankBoard("turnover", rounds, 10).map((x) => x.operator_player_id)).toEqual(["c", "z", "b", "a"]);
  });
});
