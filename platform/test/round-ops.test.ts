import { describe, it, expect } from "vitest";
import { buildContainer, type Container } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";

const CONFIG = {
  launchSecret: "s1",
  sessionSecret: "s2",
  adminSecret: "s3",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000
};

const PLAYER = "p_ops";

function setup(wallet: SandboxWallet) {
  const c = buildContainer(CONFIG, { wallet });
  const op = c.mgmt.createOperator({ name: "Ops Casino", slug: "ops-casino" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const og = c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
  const token = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: PLAYER, currency: "GEL", origin: "casino.example.com" });
  const session = c.sessions.initSession(token);
  return { c, op, og, session };
}

/** Spin until a paying round appears (or give up), returning its round_ref + win. */
async function spinUntilWin(c: Container, sessionId: string, prefix: string): Promise<{ roundRef: string; win: number }> {
  for (let i = 0; i < 300; i += 1) {
    const out = await c.orchestrator.spin(sessionId, { bet_amount: 5, idempotency_key: `${prefix}-${i}` });
    if (out.total_win > 0) return { roundRef: out.round_ref, win: out.total_win };
  }
  throw new Error("no win in 300 spins");
}

describe("round verification", () => {
  it("verifies a genuine round as legitimate and replays its stored seed", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, session } = setup(wallet);
    const out = await c.orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: "v-1" });

    const v = c.verification.verify(out.round_ref);
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe("legitimate");
    expect(v!.outcome_ok).toBe(true);
    expect(v!.chain_ok).toBe(true);
    expect(v!.recomputed_hash).toBe(v!.stored_hash);
  });

  it("flags a round as tampered when the ledger is retroactively edited", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, session } = setup(wallet);
    const out = await c.orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: "t-1" });

    // Reach into the in-memory repo and corrupt the stored win — verification must catch it.
    (c.ledger as unknown as { rounds: { __unsafeTamper(seq: number, patch: Record<string, unknown>): void } }).rounds.__unsafeTamper(0, {
      total_win: 999999
    });
    const v = c.verification.verify(out.round_ref);
    expect(v!.verdict).toBe("tampered");
    expect(v!.chain_ok).toBe(false);
  });

  it("returns 'inconclusive' when a round has no captured pre-state", () => {
    const wallet = new SandboxWallet();
    const { c } = setup(wallet);
    const resolved = c.resolver.resolve({ balance: 1000, freeSpinsLeft: 0 }, { bet_amount: 5, ante_enabled: false });
    // Record a round the old way (no pre_state) to simulate a legacy row.
    c.ledger.recordResolvedRound(
      { round_ref: "legacy-1", session_id: "s", operator_id: "o", operator_player_id: PLAYER, game_id: "g", math_config_id: "m", bet_amount: 5 },
      resolved
    );
    const v = c.verification.verify("legacy-1");
    expect(v!.verdict).toBe("inconclusive");
    expect(v!.outcome_ok).toBeNull();
  });
});

describe("round lifecycle: void + settle", () => {
  it("void refunds the bet, claws back the win, and drops the round from financials", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, op, session } = setup(wallet);
    const { roundRef, win } = await spinUntilWin(c, session.id, "void");

    const balBefore = (await wallet.balance({ operatorId: op.id }, { operatorPlayerId: PLAYER, currency: "GEL" })).amount;
    const res = await c.lifecycle.voidRound(roundRef, "admin-1", "player dispute");
    expect(res.effective_status).toBe("void");

    // Bet refunded (+5) and win clawed back (−win) → net −win relative to before.
    const balAfter = (await wallet.balance({ operatorId: op.id }, { operatorPlayerId: PLAYER, currency: "GEL" })).amount;
    expect(balAfter).toBeCloseTo(balBefore + 5 - win, 2);

    // Reconciliation still balances and the round is excluded from totals.
    const recon = c.reporting.reconcile(op.id);
    expect(recon.ok).toBe(true);
    expect(c.adjustments.effectiveStatus(roundRef, "resolved")).toBe("void");
  });

  it("void is idempotent", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, session } = setup(wallet);
    const { roundRef } = await spinUntilWin(c, session.id, "void2");
    await c.lifecycle.voidRound(roundRef, "admin-1", "x");
    const again = await c.lifecycle.voidRound(roundRef, "admin-1", "x");
    expect(again.already).toBe(true);
  });

  it("settle pays an owed win whose original credit failed", async () => {
    const wallet = new SandboxWallet({ failCreditFor: () => true });
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, op, session } = setup(wallet);
    const { roundRef, win } = await spinUntilWin(c, session.id, "settle");

    // The win landed in the failed-settlement queue (credit failed).
    expect(c.reporting.failedSettlements(op.id).some((t) => t.round_ref === roundRef)).toBe(true);

    // Flip the wallet so the retry succeeds, then settle.
    (wallet as unknown as { opts: { failCreditFor?: () => boolean } }).opts.failCreditFor = () => false;
    const balBefore = (await wallet.balance({ operatorId: op.id }, { operatorPlayerId: PLAYER, currency: "GEL" })).amount;
    const res = await c.lifecycle.settleRound(roundRef, "admin-1", "manual resettle");
    expect(res.effective_status).toBe("settled");

    const balAfter = (await wallet.balance({ operatorId: op.id }, { operatorPlayerId: PLAYER, currency: "GEL" })).amount;
    expect(balAfter).toBeCloseTo(balBefore + win, 2);
    // No longer pending.
    expect(c.reporting.failedSettlements(op.id).some((t) => t.round_ref === roundRef)).toBe(false);
  });
});

describe("dispute queue (operator raises, provider executes)", () => {
  it("operator raise → provider approve executes the void", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, op, session } = setup(wallet);
    const { roundRef } = await spinUntilWin(c, session.id, "dsp");

    const d = c.disputes.raise({ operator_id: op.id, round_ref: roundRef, kind: "void", reason: "glitch", requested_by: "op-admin" });
    expect(d.status).toBe("open");

    const resolved = await c.disputes.approve(d.id, "prov-admin", "ok");
    expect(resolved.status).toBe("approved");
    expect(c.adjustments.effectiveStatus(roundRef, "resolved")).toBe("void");
  });

  it("blocks raising a dispute against another operator's round", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, session } = setup(wallet);
    const out = await c.orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: "x-1" });
    expect(() => c.disputes.raise({ operator_id: "someone-else", round_ref: out.round_ref, kind: "void", reason: "r", requested_by: "z" })).toThrow(
      /ROUND_NOT_FOUND/
    );
  });

  it("reject closes the dispute without moving money", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100_000);
    const { c, op, session } = setup(wallet);
    const { roundRef } = await spinUntilWin(c, session.id, "rej");
    const d = c.disputes.raise({ operator_id: op.id, round_ref: roundRef, kind: "void", reason: "glitch", requested_by: "op-admin" });
    const r = c.disputes.reject(d.id, "prov-admin", "not a valid claim");
    expect(r.status).toBe("rejected");
    expect(c.adjustments.effectiveStatus(roundRef, "resolved")).toBe("resolved"); // unchanged
  });
});

describe("game on/off", () => {
  it("disabling an assignment prevents new sessions; re-enabling restores it", () => {
    const wallet = new SandboxWallet();
    const { c, op, og } = setup(wallet);
    expect(c.mgmt.findOperatorGame(op.id, "bananax", "GEL")).not.toBeNull();

    c.mgmt.setOperatorGameStatus(og.id, "disabled", "op-admin");
    expect(c.mgmt.findOperatorGame(op.id, "bananax", "GEL")).toBeNull();

    c.mgmt.setOperatorGameStatus(og.id, "enabled", "op-admin");
    expect(c.mgmt.findOperatorGame(op.id, "bananax", "GEL")).not.toBeNull();
  });
});
