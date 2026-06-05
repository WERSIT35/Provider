import { describe, it, expect } from "vitest";
import { buildContainer } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";

const CONFIG = {
  launchSecret: "s1",
  sessionSecret: "s2",
  adminSecret: "s3",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000
};

/** Provision an operator+game and open a session, returning the wired container. */
function setup(wallet: SandboxWallet) {
  const c = buildContainer(CONFIG, { wallet });
  const op = c.mgmt.createOperator({ name: "Casino R", slug: "casino-r" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
  const token = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "p_r", currency: "GEL", origin: "casino.example.com" });
  const session = c.sessions.initSession(token);
  return { c, op, session };
}

describe("reporting + reconciliation", () => {
  it("aggregates GGR/RTP and reconciles the round ledger against the money ledger", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance("p_r", "GEL", 1000);
    const { c, op, session } = setup(wallet);

    for (let i = 0; i < 25; i += 1) {
      await c.orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: `r${i}` });
    }

    const summary = c.reporting.roundsSummary(op.id);
    expect(summary.rounds).toBe(25);
    expect(summary.total_bet).toBeCloseTo(25, 2);
    expect(summary.ggr).toBeCloseTo(summary.total_bet - summary.total_win, 2);

    const rtp = c.reporting.rtpReport(op.id);
    expect(rtp.actual_rtp_percent).toBeGreaterThanOrEqual(0);

    // Money ledger reconciles: confirmed debits equal total bet; credits never exceed wins.
    const recon = c.reporting.reconcile(op.id);
    expect(recon.tx_debits).toBeCloseTo(summary.total_bet, 2);
    expect(recon.ok).toBe(true);

    // GGR-by-day has one bucket (all rounds today).
    expect(c.reporting.ggrByDay(op.id).length).toBe(1);
  });

  it("surfaces failed settlements when win credits fail", async () => {
    const wallet = new SandboxWallet({ failCreditFor: () => true });
    wallet.setBalance("p_r", "GEL", 1000);
    const { c, op, session } = setup(wallet);

    let win = 0;
    for (let i = 0; i < 200 && win === 0; i += 1) {
      const out = await c.orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: `f${i}` });
      win = out.total_win;
    }
    const failed = c.reporting.failedSettlements(op.id);
    if (win > 0) {
      expect(failed.length).toBeGreaterThan(0);
      expect(failed[0].type).toBe("CREDIT");
      expect(failed[0].status).toBe("failed");
    }
  });
});
