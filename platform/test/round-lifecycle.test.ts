import { describe, it, expect } from "vitest";
import { EngineService } from "../src/modules/engine/engine.service";
import { AuthoritativeResolver } from "../src/modules/rng/authoritative-resolver";
import { ManagementService } from "../src/modules/management/management.service";
import { SessionService } from "../src/modules/session/session.service";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { RoundOrchestrator, type ResolverPort } from "../src/modules/rounds/round-orchestrator";
import { RoundLedgerService } from "../src/modules/ledger/round-ledger.service";
import { InMemoryRoundRepository, InMemoryAuditRepository } from "../src/modules/ledger/memory-repositories";
import { InMemoryTransactionStore } from "../src/modules/wallet/transaction-store";

const LAUNCH_SECRET = "test-launch-secret";
const PLAYER = "p_1";

function harness(opts: { wallet?: SandboxWallet; resolver?: ResolverPort } = {}) {
  const engine = new EngineService();
  const audit = new InMemoryAuditRepository();
  const mgmt = new ManagementService(audit);
  const rounds = new InMemoryRoundRepository();
  const ledger = new RoundLedgerService(rounds, audit);
  const sessions = new SessionService(mgmt, LAUNCH_SECRET);
  const wallet = opts.wallet ?? new SandboxWallet();
  const resolver = opts.resolver ?? new AuthoritativeResolver(engine);

  // Provision operator → domain → approved config → assignment.
  const op = mgmt.createOperator({ name: "Casino One", slug: "casino-one" });
  mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = mgmt.createMathConfig({
    game_id: game.id,
    version: "3.0.0",
    rtp_profile_key: "bananax",
    theoretical_rtp: 96.38,
    config_hash: "hash"
  });
  cfg = mgmt.submitMathConfigForReview(cfg.id);
  cfg = mgmt.approveMathConfig(cfg.id, "lead");
  mgmt.assignGame({
    operator_id: op.id,
    game_id: game.id,
    math_config_id: cfg.id,
    currency: "GEL",
    allowed_bets: [1, 5, 500]
  });

  const token = sessions.createLaunchToken({
    operator_id: op.id,
    game_code: "bananax",
    operator_player_id: PLAYER,
    currency: "GEL",
    origin: "casino.example.com"
  });
  const session = sessions.initSession(token);

  const transactions = new InMemoryTransactionStore();
  const orchestrator = new RoundOrchestrator(engine, resolver, sessions, mgmt, wallet, ledger, transactions);
  return { engine, mgmt, sessions, wallet, ledger, rounds, transactions, orchestrator, op, session };
}

describe("round lifecycle (launch → session → debit → resolve → record → credit)", () => {
  it("rejects launch from a non-allowlisted origin", () => {
    const { mgmt, sessions, op } = harness();
    expect(() =>
      sessions.createLaunchToken({
        operator_id: op.id,
        game_code: "bananax",
        operator_player_id: PLAYER,
        currency: "GEL",
        origin: "evil.example.com"
      })
    ).toThrow(/DOMAIN_NOT_ALLOWED/);
    expect(mgmt).toBeDefined();
  });

  it("resolves a spin: debits the stake, records an immutable round, settles the win", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100);
    const { orchestrator, session, ledger, rounds } = harness({ wallet });

    const outcome = await orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "k1" });

    expect(outcome.round_ref).toBe("r_k1");
    expect(outcome.outcome_hash).toHaveLength(64);
    expect(outcome.bet_charged).toBe(1);
    // balance = 100 - 1 stake + win
    expect(outcome.balance.amount).toBeCloseTo(100 - 1 + outcome.total_win, 2);
    // Immutable round persisted and chain intact.
    expect(rounds.getByRef("r_k1")).not.toBeNull();
    expect(ledger.verifyIntegrity().rounds.ok).toBe(true);
  });

  it("is idempotent: replaying the same key never double-charges", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100);
    const { orchestrator, session } = harness({ wallet });

    const first = await orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "dup" });
    const balanceAfterFirst = (await wallet.balance({ operatorId: session.operator_id }, { operatorPlayerId: PLAYER, currency: "GEL" })).amount;

    const second = await orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "dup" });
    const balanceAfterSecond = (await wallet.balance({ operatorId: session.operator_id }, { operatorPlayerId: PLAYER, currency: "GEL" })).amount;

    expect(second.idempotent_replay).toBe(true);
    expect(second.round_ref).toBe(first.round_ref);
    expect(second.total_win).toBe(first.total_win);
    expect(balanceAfterSecond).toBe(balanceAfterFirst); // no second debit/credit
  });

  it("declines and records no round when the wallet has insufficient funds", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 0);
    const { orchestrator, session, rounds } = harness({ wallet });

    await expect(orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: "nf" })).rejects.toThrow(
      /INSUFFICIENT_FUNDS/
    );
    expect(rounds.getByRef("r_nf")).toBeNull();
    expect(rounds.size()).toBe(0);
  });

  it("rolls back the debit when resolution fails after charging", async () => {
    const wallet = new SandboxWallet();
    wallet.setBalance(PLAYER, "GEL", 100);
    const failingResolver: ResolverPort = {
      resolve() {
        throw new Error("ENGINE_FAILURE");
      }
    };
    const { orchestrator, session, rounds } = harness({ wallet, resolver: failingResolver });

    await expect(orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: "rb" })).rejects.toThrow(
      /ENGINE_FAILURE/
    );
    // Debit was reversed → balance restored; no round recorded.
    const bal = await wallet.balance({ operatorId: session.operator_id }, { operatorPlayerId: PLAYER, currency: "GEL" });
    expect(bal.amount).toBe(100);
    expect(rounds.size()).toBe(0);
  });

  it("keeps the round and flags settlement when the win credit fails", async () => {
    // Force credit to fail so we exercise the failed-settlement path.
    const wallet = new SandboxWallet({ failCreditFor: () => true });
    wallet.setBalance(PLAYER, "GEL", 1000);
    const { orchestrator, session, rounds } = harness({ wallet });

    // Try spins until we hit a winning one (high-vol game; bound the attempts).
    let outcome = await orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "c0" });
    let i = 0;
    while (outcome.total_win <= 0 && i < 200) {
      i += 1;
      outcome = await orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: `c${i}` });
    }
    if (outcome.total_win > 0) {
      expect(outcome.settlement).toBe("credit_pending");
    }
    // Regardless, every resolved round is recorded immutably.
    expect(rounds.size()).toBeGreaterThan(0);
    expect((rounds.verifyChain()).ok).toBe(true);
  });
});
