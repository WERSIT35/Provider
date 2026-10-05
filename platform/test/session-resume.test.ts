import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

let app: FastifyInstance;
let c: Container;
let wallet: SandboxWallet;
let opId: string;
let gameId: string;
let key = 0;

async function setup() {
  wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  gameId = game.id;
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  for (const currency of ["GEL", "EUR"]) {
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency, allowed_bets: [1, 5, 10] });
  }
  wallet.setBalance("p1", "GEL", 100_000);
  wallet.setBalance("p1", "EUR", 100_000);
  wallet.setBalance("p2", "GEL", 100_000);
}

/** What the casino does on every launch: a fresh launch token. */
const launch = (player = "p1", currency = "GEL") =>
  c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: player, currency, origin: "casino.example.com" });
const init = async (lt: string) => {
  const res = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  expect(res.statusCode).toBe(200);
  return res.json();
};
const call = (path: string, token: string, body: object) =>
  app.inject({ method: "POST", url: `/game/v1/${path}`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": `k${key++}` }, payload: JSON.stringify(body) });
/** Buy at `bet` and play `spins` of the feature; leaves the rest unplayed (the "refresh"). */
async function buyAndPlayPart(token: string, bet: number, spins: number) {
  const buy = await call("buy-feature", token, { bet_amount: bet });
  expect(buy.statusCode).toBe(200);
  for (let i = 0; i < spins; i++) expect((await call("spin", token, { bet_amount: 1 })).statusCode).toBe(200);
  return buy.json() as { round_ref: string };
}

describe("session resume on reload / relaunch", () => {
  beforeEach(setup);

  it("a relaunch mid-bonus resumes the SAME session with its feature intact (nothing stranded)", async () => {
    const first = await init(launch());
    expect(first.resume).toMatchObject({ resumed: false, bet_amount: null, feature: null });
    const buy = await buyAndPlayPart(first.session_token, 5, 3);
    const live = c.sessions.get(first.session_id);
    expect(live.free_spins_left).toBeGreaterThan(0);

    // The casino relaunches the game (new launch token): the bonus comes back.
    const again = await init(launch());
    expect(again.session_id).toBe(first.session_id);
    expect(again.free_spins_left).toBe(live.free_spins_left);
    expect(again.resume).toMatchObject({
      resumed: true,
      bet_amount: 5,
      ante_enabled: false,
      feature: {
        free_spins_left: live.free_spins_left,
        locked_bet: 5,
        locked_ante: false,
        feature_ref: buy.round_ref,
        multiplier_bank: live.free_spin_multiplier_carry,
        bonus_round_win: live.bonus_round_win
      }
    });

    // Play the rest on the NEW token, asking for 1.00: the locked 5.00 still applies,
    // and the bonus completes as one family under the original trigger.
    let left = again.free_spins_left;
    while (left > 0) {
      const res = await call("spin", again.session_token, { bet_amount: 1 });
      const out = res.json();
      expect(c.ledger.getRound(out.round_ref)!.bet_amount).toBe(5);
      left = out.free_spins_left;
    }
    const fam = c.ledger.featureFamily(buy.round_ref)!;
    const awarded = fam.rounds.reduce((s, r) => s + Number((r.outcome as { free_spins_awarded?: number }).free_spins_awarded || 0), 0);
    expect(fam.rounds.length - 1).toBe(awarded); // every free spin awarded was played
    expect(c.sessions.listByOperator(opId).length).toBe(1); // no second session was opened
  });

  it("a reload with the kept session token reads the state and opens nothing", async () => {
    const first = await init(launch());
    await buyAndPlayPart(first.session_token, 10, 2);
    const res = await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${first.session_token}` } });
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.session_id).toBe(first.session_id);
    expect(state.session_token).toBeUndefined(); // the client already has it
    expect(state.resume).toMatchObject({ bet_amount: 10, feature: { locked_bet: 10 } });
    expect(c.sessions.listByOperator(opId).length).toBe(1);
    expect((await app.inject({ method: "GET", url: "/game/v1/session" })).statusCode).toBe(401);
  });

  it("outside a feature: a new session, starting on the player's last cash bet and ante", async () => {
    const first = await init(launch());
    for (const [bet, ante] of [[1, false], [10, true]] as const) {
      // A paid spin may trigger the bonus naturally; play it out so the session ends idle.
      expect((await call("spin", first.session_token, { bet_amount: bet, ante_enabled: ante })).statusCode).toBe(200);
      while (c.sessions.get(first.session_id).free_spins_left > 0) await call("spin", first.session_token, { bet_amount: bet });
    }
    const next = await init(launch());
    expect(next.session_id).not.toBe(first.session_id);
    expect(next.resume).toMatchObject({ resumed: false, bet_amount: 10, ante_enabled: true, feature: null });
  });

  it("a free round's bet is the casino's, not the player's: it is never restored", async () => {
    const first = await init(launch());
    expect((await call("spin", first.session_token, { bet_amount: 5 })).statusCode).toBe(200);
    while (c.sessions.get(first.session_id).free_spins_left > 0) await call("spin", first.session_token, { bet_amount: 5 });
    const campaign = c.campaigns.createCampaign({ operator_id: opId, game_id: gameId, name: "promo", currency: "GEL", bet_amount: 10, total_spins: 1, valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: new Date(Date.now() + 864e5).toISOString(), created_by: "test" });
    c.campaigns.grantPlayers(campaign.id, ["p1"]);
    const promo = await init(launch());
    expect(promo.free_rounds).toHaveLength(1);
    const played = (await call("spin", promo.session_token, { bet_amount: 1 })).json();
    expect(c.ledger.getRound(played.round_ref)).toMatchObject({ bet_amount: 10, campaign_id: campaign.id }); // the free round, at 10
    while (c.sessions.get(promo.session_id).free_spins_left > 0) await call("spin", promo.session_token, { bet_amount: 1 });
    expect((await init(launch())).resume.bet_amount).toBe(5); // the player's own last bet
  });

  it("never resumes across players, currencies or a closed session", async () => {
    const mine = await init(launch("p1", "GEL"));
    await buyAndPlayPart(mine.session_token, 5, 1);
    expect((await init(launch("p2", "GEL"))).resume.resumed).toBe(false); // another player
    expect((await init(launch("p1", "EUR"))).resume.resumed).toBe(false); // another currency
    c.sessions.close(mine.session_id);
    const after = await init(launch("p1", "GEL"));
    expect(after.session_id).not.toBe(mine.session_id);
    expect(after.resume.feature).toBeNull();
  });

  it("a restored bet that is no longer allowed is not restored", async () => {
    const first = await init(launch());
    expect((await call("spin", first.session_token, { bet_amount: 10 })).statusCode).toBe(200);
    while (c.sessions.get(first.session_id).free_spins_left > 0) await call("spin", first.session_token, { bet_amount: 10 });
    // The casino re-assigns the game without 10.00.
    const old = c.mgmt.findOperatorGame(opId, "bananax", "GEL")!;
    c.mgmt.setOperatorGameStatus(old.id, "disabled");
    c.mgmt.assignGame({ operator_id: opId, game_id: gameId, math_config_id: old.math_config_id, currency: "GEL", allowed_bets: [1, 5] });
    const next = await init(launch());
    expect(next.allowed_bets).toEqual([1, 5]);
    expect(next.resume.bet_amount).toBeNull();
  });

  it("a bet is only restored in the currency it was placed in", async () => {
    const gel = await init(launch("p1", "GEL"));
    expect((await call("spin", gel.session_token, { bet_amount: 10 })).statusCode).toBe(200);
    while (c.sessions.get(gel.session_id).free_spins_left > 0) await call("spin", gel.session_token, { bet_amount: 10 });
    expect((await init(launch("p1", "EUR"))).resume.bet_amount).toBeNull();
    expect((await init(launch("p1", "GEL"))).resume.bet_amount).toBe(10);
  });
});
