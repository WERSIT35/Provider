import { describe, it, expect } from "vitest";
import { buildContainer, type Container } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { generateSeed } from "../src/lib/seeded-rng";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };

function provision(): { c: Container; sessionId: string } {
  const wallet = new SandboxWallet();
  const c = buildContainer(CONFIG, { wallet });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  wallet.setBalance("p1", "GEL", 100_000);
  const token = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  return { c, sessionId: c.sessions.initSession(token).id };
}

describe("20,000x max win covers the whole feature round", () => {
  it("a free spin can only pay what is left under the cap carried from earlier spins", () => {
    const { c } = provision();
    const cap = 20_000;
    for (let i = 0; i < 300; i += 1) {
      const { result } = c.engine.resolveDeterministic(
        { gameId: "bananax", balance: 1e9, freeSpinsLeft: 5, freeSpinPersistentMultiplier: 50, bonusRoundWin: cap - 0.5 },
        { bet_amount: 1 },
        generateSeed().toString("hex")
      );
      expect(result.total_win).toBeLessThanOrEqual(0.5);
    }
  });

  it("the session carries the running total, records it in pre_state, and every feature round replays", async () => {
    const { c, sessionId } = provision();
    const buy = await c.orchestrator.buyFeature(sessionId, { bet_amount: 1, idempotency_key: "buy" });
    const refs = [buy.round_ref];
    let running = c.sessions.get(sessionId).bonus_round_win;
    // The trigger spin's win seeds the feature total.
    expect(running).toBeCloseTo(buy.total_win, 2);
    let i = 0;
    while (c.sessions.get(sessionId).free_spins_left > 0) {
      const out = await c.orchestrator.spin(sessionId, { bet_amount: 1, idempotency_key: `fs-${i++}` });
      refs.push(out.round_ref);
      expect(c.ledger.getRound(out.round_ref)?.pre_state?.bonus_round_win).toBeCloseTo(running, 2);
      running = Number((running + out.total_win).toFixed(2));
    }
    // Feature over: the total is cleared for the next feature.
    expect(c.sessions.get(sessionId).bonus_round_win).toBe(0);
    for (const ref of refs) expect(c.verification.verify(ref)?.verdict).toBe("legitimate");
  });
});
