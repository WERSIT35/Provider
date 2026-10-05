import { describe, it, expect, beforeEach } from "vitest";
import { buildContainer, type Container } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import type { CreditArgs, WalletContext, WalletTxResult } from "../src/modules/wallet/wallet.types";
import type { Session } from "../src/modules/session/session.service";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };

/** Sandbox wallet that records every credit it is asked for (the webhook body, in effect). */
class RecordingWallet extends SandboxWallet {
  credits: CreditArgs[] = [];
  /** When set, the next credit is APPLIED and then its response is "lost" (a timeout). */
  loseNextCreditResponse = false;
  override async credit(ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult> {
    this.credits.push({ ...args });
    const result = await super.credit(ctx, args);
    if (this.loseNextCreditResponse) {
      this.loseNextCreditResponse = false;
      throw new Error("WEBHOOK_CALL_FAILED");
    }
    return result;
  }
}

let c: Container;
let wallet: RecordingWallet;
let opId: string;
let keySeq = 0;

function setup() {
  wallet = new RecordingWallet();
  c = buildContainer(CONFIG, { wallet });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
}

function openSession(player = "p1"): Session {
  const token = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
  return c.sessions.initSession(token);
}
const live = (id: string) => c.sessions.get(id);
const spin = (sessionId: string) => c.orchestrator.spin(sessionId, { bet_amount: 1, idempotency_key: `k${keySeq++}` });

/** Buy the feature and play it out; returns the trigger's round_ref and the feature spins' refs. */
async function playBoughtFeature(sessionId: string) {
  const buy = await c.orchestrator.buyFeature(sessionId, { bet_amount: 1, idempotency_key: `buy${keySeq++}` });
  expect(live(sessionId).locked_feature_ref).toBe(buy.round_ref);
  const spins: string[] = [];
  while (live(sessionId).free_spins_left > 0) {
    spins.push((await spin(sessionId)).round_ref);
    if (live(sessionId).free_spins_left > 0) expect(live(sessionId).locked_feature_ref).toBe(buy.round_ref); // retriggers keep it
  }
  return { trigger: buy.round_ref, spins };
}

describe("bonus grouping (featureRef)", () => {
  beforeEach(setup);

  it("every free-spin credit carries the trigger's round_ref; nothing outside the feature does", async () => {
    wallet.setBalance("p1", "GEL", 100_000);
    const s = openSession();
    // A free spin that wins nothing moves no money, so loop until the feature paid at least once.
    let free: CreditArgs[] = [];
    let trigger = "";
    for (let i = 0; i < 10 && free.length === 0; i++) {
      wallet.credits = [];
      ({ trigger } = await playBoughtFeature(s.id));
      free = wallet.credits.filter((x) => x.roundType === "free_spin");
    }
    expect(free.length).toBeGreaterThan(0);
    for (const credit of free) expect(credit.featureRef).toBe(trigger);
    // The trigger round itself is the group head: its own moves carry no featureRef.
    for (const credit of wallet.credits.filter((x) => x.roundType !== "free_spin")) expect(credit.featureRef).toBeUndefined();
    // Leaving the feature clears the group key with the rest of the lock.
    expect(live(s.id)).toMatchObject({ free_spins_left: 0, locked_bet: null, locked_feature_ref: null });

    // A paid spin after the feature is not part of any group.
    wallet.credits = [];
    for (let i = 0; i < 30 && live(s.id).free_spins_left === 0; i++) await spin(s.id);
    if (live(s.id).free_spins_left === 0) for (const credit of wallet.credits) expect(credit.featureRef).toBeUndefined();
  });

  it("a legacy lock rebuilt mid-feature recovers the trigger's ref from the round ledger", async () => {
    wallet.setBalance("p1", "GEL", 100_000);
    const s = openSession();
    const buy = await c.orchestrator.buyFeature(s.id, { bet_amount: 1, idempotency_key: `buy${keySeq++}` });
    await spin(s.id); // one feature spin, so the newest round is a free spin
    Object.assign(live(s.id), { locked_bet: null, locked_currency: null, locked_ante: null, locked_feature_ref: null }); // pre-lock row
    if (live(s.id).free_spins_left > 0) {
      await spin(s.id);
      if (live(s.id).free_spins_left > 0) expect(live(s.id).locked_feature_ref).toBe(buy.round_ref);
    }
  });
});

describe("settling a credit whose response was lost", () => {
  beforeEach(setup);

  it("re-sends the original idempotency key, so a win that already landed is not paid twice", async () => {
    wallet.setBalance("p1", "GEL", 100_000);
    const s = openSession();
    // Find a winning paid round whose credit lands at the wallet but whose response is lost.
    let roundRef = "";
    let win = 0;
    for (let i = 0; i < 500 && !roundRef; i++) {
      if (live(s.id).free_spins_left > 0) { await spin(s.id); continue; }
      wallet.loseNextCreditResponse = true;
      const out = await spin(s.id);
      if (out.total_win > 0) {
        expect(out.settlement).toBe("credit_pending");
        roundRef = out.round_ref;
        win = out.total_win;
      }
      wallet.loseNextCreditResponse = false;
    }
    expect(roundRef).not.toBe("");
    const before = (await wallet.balance({ operatorId: opId }, { operatorPlayerId: "p1", currency: "GEL" })).amount;

    const settled = await c.lifecycle.settleRound(roundRef, "admin", "credit timed out");
    expect(settled.effective_status).toBe("settled");

    // The retry used the original key, so the wallet replayed the credit it already applied.
    const forRound = wallet.credits.filter((x) => x.roundRef === roundRef);
    expect(forRound).toHaveLength(2);
    expect(forRound[1].idempotencyKey).toBe(forRound[0].idempotencyKey);
    const after = (await wallet.balance({ operatorId: opId }, { operatorPlayerId: "p1", currency: "GEL" })).amount;
    expect(after).toBe(before); // paid once (at the original call), not again
    expect(win).toBeGreaterThan(0);
    // And the round left the failed-settlement queue.
    expect(c.transactions.listFailedSettlements(opId).some((t) => t.round_ref === roundRef)).toBe(false);
  });
});
