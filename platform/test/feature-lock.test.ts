import { describe, it, expect, beforeEach } from "vitest";
import { buildContainer, type Container } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import type { Persistence } from "../src/persistence/persistence";
import type { Session } from "../src/modules/session/session.service";
import type { SpinResult } from "../src/modules/engine/engine.types";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };
const IN_A_WEEK = () => new Date(Date.now() + 7 * 864e5).toISOString();

let c: Container;
let wallet: SandboxWallet;
let opId: string;
let gameId: string;
let sessionSaves: Array<Record<string, unknown>>;
let keySeq = 0;

function setup() {
  wallet = new SandboxWallet();
  sessionSaves = [];
  const recorder: Persistence = {
    save: (table, row) => void (table === "player_sessions" && sessionSaves.push({ ...(row as Record<string, unknown>) })),
    flush: async () => {},
    loadTable: async () => []
  };
  c = buildContainer(CONFIG, { wallet, persistence: recorder });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  gameId = game.id;
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
}

function openSession(player = "p1"): Session {
  const token = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
  return c.sessions.initSession(token);
}
const live = (id: string) => c.sessions.get(id); // the live session object
const spin = (sessionId: string, bet: number, ante = false) =>
  c.orchestrator.spin(sessionId, { bet_amount: bet, ante_enabled: ante, idempotency_key: `k${keySeq++}` });

/** Trigger the feature for real: Buy Feature always triggers it. */
async function buyIntoFeature(sessionId: string, bet: number) {
  const out = await c.orchestrator.buyFeature(sessionId, { bet_amount: bet, idempotency_key: `buy${keySeq++}` });
  expect(live(sessionId).free_spins_left).toBeGreaterThan(0);
  return out;
}

describe("bonus feature bet lock", () => {
  beforeEach(setup);

  it("a feature triggered at 1.00 plays every spin at 1.00, whatever the client asks", async () => {
    wallet.setBalance("p1", "GEL", 10_000);
    const s = openSession();
    await buyIntoFeature(s.id, 1);
    expect(live(s.id)).toMatchObject({ locked_bet: 1, locked_currency: "GEL", locked_ante: false, locked_campaign_id: null });

    let featureSpins = 0;
    while (live(s.id).free_spins_left > 0) {
      // The exploit attempt: max bet, ante on, and even a bet that isn't allowed.
      const asked = featureSpins % 2 === 0 ? 500 : 7;
      const out = await spin(s.id, asked, true);
      const round = c.ledger.getRound(out.round_ref)!;
      expect(round).toMatchObject({ bet_amount: 1, bet_charged: 0, ante_enabled: false, is_free_spin: true });
      expect(round.pre_state?.ante_enabled).toBe(false);
      // Recorded at the locked terms, so the seed replay reproduces it exactly.
      if (featureSpins < 3) expect(c.verification.verify(out.round_ref)?.verdict).toBe("legitimate");
      featureSpins += 1;
      expect(featureSpins).toBeLessThan(500); // retriggers are finite
    }

    // Feature over → lock cleared → the client's bet applies again (and is charged).
    expect(live(s.id)).toMatchObject({ locked_bet: null, locked_currency: null, locked_ante: null });
    const before = (await c.wallet.balance({ operatorId: opId }, { operatorPlayerId: "p1", currency: "GEL" })).amount;
    const paid = await spin(s.id, 500);
    expect(paid.bet_charged).toBe(500);
    expect(paid.balance.amount).toBe(Number((before - 500 + paid.total_win).toFixed(2)));
  });

  it("locks ante as it was at the trigger (ante on can't be switched off/on mid-feature)", async () => {
    wallet.setBalance("p1", "GEL", 10_000);
    const s = openSession();
    // Simulate an ante-on trigger through the same entry point the orchestrator uses.
    c.sessions.applyResult(s.id, { free_spins_left: 3 } as unknown as SpinResult, {
      bet: 5, currency: "GEL", ante_enabled: true, campaign_id: null, grant_id: null, feature_ref: "r_sim_trigger"
    });
    const out = await spin(s.id, 500, false);
    expect(c.ledger.getRound(out.round_ref)).toMatchObject({ bet_amount: 5, ante_enabled: true, bet_charged: 0 });
  });

  it("rejects Buy Feature while a feature is running", async () => {
    wallet.setBalance("p1", "GEL", 10_000);
    const s = openSession();
    await buyIntoFeature(s.id, 1);
    await expect(c.orchestrator.buyFeature(s.id, { bet_amount: 500, idempotency_key: "rebuy" })).rejects.toThrow("FEATURE_IN_PROGRESS");
  });

  it("persists the lock with the session (write-through)", async () => {
    wallet.setBalance("p1", "GEL", 10_000);
    const s = openSession();
    await buyIntoFeature(s.id, 5);
    expect(sessionSaves.at(-1)).toMatchObject({ id: s.id, locked_bet: 5, locked_currency: "GEL", locked_ante: false });
  });

  it("rebuilds a missing lock (session mid-feature before locks shipped) from the last round", async () => {
    wallet.setBalance("p1", "GEL", 10_000);
    const s = openSession();
    await buyIntoFeature(s.id, 5);
    Object.assign(live(s.id), { locked_bet: null, locked_currency: null, locked_ante: null }); // legacy row
    const out = await spin(s.id, 500);
    expect(c.ledger.getRound(out.round_ref)!.bet_amount).toBe(5);
    if (live(s.id).free_spins_left > 0) expect(live(s.id).locked_bet).toBe(5);
  });
});

describe("feature triggered by an operator free round", () => {
  beforeEach(setup);

  async function freeRoundIntoFeature(spins: number) {
    const campaign = c.campaigns.createCampaign({
      operator_id: opId, game_id: gameId, name: "W", currency: "GEL", bet_amount: 5, total_spins: 1,
      valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: IN_A_WEEK(), created_by: "t"
    });
    const [grant] = c.campaigns.grantPlayers(campaign.id, ["p1"]).granted;
    wallet.setBalance("p1", "GEL", 100);
    const s = openSession();
    const fr = await spin(s.id, 1);
    expect(fr.free_round?.campaign_id).toBe(campaign.id);
    // A free-round trigger is random; enter the feature through the same entry point
    // with the terms that round was played at (what the orchestrator passes).
    if (live(s.id).free_spins_left === 0) {
      c.sessions.applyResult(s.id, { free_spins_left: spins } as unknown as SpinResult, {
        bet: 5, currency: "GEL", ante_enabled: false, campaign_id: campaign.id, grant_id: grant.id, feature_ref: "r_sim_trigger"
      });
    }
    expect(live(s.id)).toMatchObject({ locked_bet: 5, locked_campaign_id: campaign.id, locked_grant_id: grant.id });
    return { s, campaign, grant, freeRoundWin: fr.total_win };
  }

  it("pays every feature win as FREE_ROUND_WIN against the campaign, without using campaign spins", async () => {
    const { s, campaign, grant, freeRoundWin } = await freeRoundIntoFeature(40);
    let featureWins = 0;
    const refs: string[] = [];
    while (live(s.id).free_spins_left > 0) {
      const out = await spin(s.id, 500);
      expect(out.free_round).toBeNull();
      expect(c.ledger.getRound(out.round_ref)).toMatchObject({ bet_amount: 5, bet_charged: 0, is_free_spin: true, campaign_id: campaign.id, grant_id: grant.id });
      featureWins += out.total_win;
      refs.push(out.round_ref);
    }
    const txs = refs.flatMap((r) => c.transactions.list({ round_ref: r }));
    expect(txs.some((t) => t.type === "CREDIT" || t.type === "DEBIT")).toBe(false);
    expect(txs.every((t) => t.type === "FREE_ROUND_WIN" && t.campaign_id === campaign.id)).toBe(true);
    expect(featureWins).toBeGreaterThan(0); // 40 feature spins: sanity that wins were exercised

    const g = c.campaigns.getGrant(grant.id)!;
    expect(g.spins_remaining).toBe(0); // only the one free round was used
    expect(g.total_won).toBeCloseTo(freeRoundWin + featureWins, 2);
    expect(c.reporting.reconcile(opId).ok).toBe(true);

    // Feature over → back to cash at the client's bet.
    const paid = await spin(s.id, 1);
    expect(paid.bet_charged).toBe(1);
    expect(c.transactions.list({ round_ref: paid.round_ref }).find((t) => t.type === "DEBIT")?.campaign_id).toBeUndefined();
  });
});

describe("voiding a free round returns the spin", () => {
  beforeEach(setup);

  it("restores the consumed free round (exhausted → active) and claws back any win", async () => {
    const campaign = c.campaigns.createCampaign({
      operator_id: opId, game_id: gameId, name: "W", currency: "GEL", bet_amount: 5, total_spins: 1,
      valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: IN_A_WEEK(), created_by: "t"
    });
    const [grant] = c.campaigns.grantPlayers(campaign.id, ["p1"]).granted;
    wallet.setBalance("p1", "GEL", 100);
    const s = openSession();
    const out = await spin(s.id, 1);
    expect(c.campaigns.getGrant(grant.id)).toMatchObject({ spins_remaining: 0, status: "exhausted" });

    const res = await c.lifecycle.voidRound(out.round_ref, "ops", "stuck game");
    expect(c.campaigns.getGrant(grant.id)).toMatchObject({ spins_remaining: 1, status: "active" });
    expect(res.notes.join(" ")).toMatch(/free round returned to player \(1 left\)/);
    if (out.total_win > 0) expect(res.notes.join(" ")).toMatch(/clawed back/);

    // Voiding again is a no-op: the spin is not returned twice.
    await c.lifecycle.voidRound(out.round_ref, "ops", "again");
    expect(c.campaigns.getGrant(grant.id)!.spins_remaining).toBe(1);
  });

  it("does not return a spin when voiding a feature spin the free round triggered", async () => {
    const campaign = c.campaigns.createCampaign({
      operator_id: opId, game_id: gameId, name: "W", currency: "GEL", bet_amount: 5, total_spins: 1,
      valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: IN_A_WEEK(), created_by: "t"
    });
    const [grant] = c.campaigns.grantPlayers(campaign.id, ["p1"]).granted;
    wallet.setBalance("p1", "GEL", 100);
    const s = openSession();
    await spin(s.id, 1);
    if (live(s.id).free_spins_left === 0) {
      c.sessions.applyResult(s.id, { free_spins_left: 2 } as unknown as SpinResult, {
        bet: 5, currency: "GEL", ante_enabled: false, campaign_id: campaign.id, grant_id: grant.id, feature_ref: "r_sim_trigger"
      });
    }
    const featureSpin = await spin(s.id, 1);
    expect(c.ledger.getRound(featureSpin.round_ref)).toMatchObject({ is_free_spin: true, grant_id: grant.id });
    await c.lifecycle.voidRound(featureSpin.round_ref, "ops", "test");
    expect(c.campaigns.getGrant(grant.id)!.spins_remaining).toBe(0);
  });

  it("does not resurrect a spin on a cancelled campaign", async () => {
    const campaign = c.campaigns.createCampaign({
      operator_id: opId, game_id: gameId, name: "W", currency: "GEL", bet_amount: 5, total_spins: 2,
      valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: IN_A_WEEK(), created_by: "t"
    });
    const [grant] = c.campaigns.grantPlayers(campaign.id, ["p1"]).granted;
    wallet.setBalance("p1", "GEL", 100);
    const out = await spin(openSession().id, 1);
    c.campaigns.cancelCampaign(campaign.id);
    const res = await c.lifecycle.voidRound(out.round_ref, "ops", "test");
    expect(c.campaigns.getGrant(grant.id)).toMatchObject({ status: "cancelled", spins_remaining: 1 });
    expect(res.notes.join(" ")).toMatch(/not returned: grant is cancelled/);
  });
});
