import { describe, it, expect } from "vitest";
import { EngineService } from "../src/modules/engine/engine.service";
import { AuthoritativeResolver } from "../src/modules/rng/authoritative-resolver";
import { InMemoryRoundRepository, InMemoryAuditRepository } from "../src/modules/ledger/memory-repositories";
import { RoundLedgerService, type RoundContext } from "../src/modules/ledger/round-ledger.service";

function ctx(ref: string): RoundContext {
  return {
    round_ref: ref,
    session_id: "sess-1",
    operator_id: "op-1",
    operator_player_id: "p1",
    game_id: "bananax",
    math_config_id: "mc-1",
    bet_amount: 1
  };
}

const snapshot = { balance: 1_000_000, freeSpinsLeft: 0 };
const input = { bet_amount: 1, ante_enabled: false };

describe("immutable round ledger + hash chain", () => {
  it("records resolved rounds, links the chain, and verifies integrity", () => {
    const engine = new EngineService();
    const resolver = new AuthoritativeResolver(engine);
    const rounds = new InMemoryRoundRepository();
    const audit = new InMemoryAuditRepository();
    const ledger = new RoundLedgerService(rounds, audit);

    const r1 = ledger.recordResolvedRound(ctx("r-1"), resolver.resolve(snapshot, input));
    const r2 = ledger.recordResolvedRound(ctx("r-2"), resolver.resolve(snapshot, input));

    expect(r1.seq).toBe(0);
    expect(r2.seq).toBe(1);
    expect(r2.prev_hash).toBe(r1.chain_hash); // chain links
    expect(r1.outcome_hash).toHaveLength(64);

    const integrity = ledger.verifyIntegrity();
    expect(integrity.rounds.ok).toBe(true);
    expect(integrity.audit.ok).toBe(true);
    expect(rounds.size()).toBe(2);
    expect(audit.size()).toBe(2); // one round.resolved audit per round
  });

  it("rejects duplicate round_ref (idempotent ledger key)", () => {
    const engine = new EngineService();
    const resolver = new AuthoritativeResolver(engine);
    const ledger = new RoundLedgerService(new InMemoryRoundRepository(), new InMemoryAuditRepository());
    ledger.recordResolvedRound(ctx("dup"), resolver.resolve(snapshot, input));
    expect(() => ledger.recordResolvedRound(ctx("dup"), resolver.resolve(snapshot, input))).toThrow(
      /DUPLICATE_ROUND_REF/
    );
  });

  it("detects tampering anywhere in the chain", () => {
    const engine = new EngineService();
    const resolver = new AuthoritativeResolver(engine);
    const rounds = new InMemoryRoundRepository();
    const ledger = new RoundLedgerService(rounds, new InMemoryAuditRepository());
    ledger.recordResolvedRound(ctx("r-1"), resolver.resolve(snapshot, input));
    ledger.recordResolvedRound(ctx("r-2"), resolver.resolve(snapshot, input));

    expect(rounds.verifyChain().ok).toBe(true);
    // Retroactively alter a settled amount — exactly what immutability must catch.
    rounds.__unsafeTamper(0, { total_win: 999999 });
    const verdict = rounds.verifyChain();
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).toBe(0);
    expect(verdict.reason).toBe("payload_hash_mismatch");
  });

  it("a recorded round can be deterministically replayed from its stored seed", () => {
    const engine = new EngineService();
    const resolver = new AuthoritativeResolver(engine);
    const rounds = new InMemoryRoundRepository();
    const ledger = new RoundLedgerService(rounds, new InMemoryAuditRepository());

    const resolved = resolver.resolve(snapshot, input);
    const record = ledger.recordResolvedRound(ctx("r-replay"), resolved);

    // Auditor re-runs the stored seed against the same pre-spin state.
    const reproduced = resolver.verifyReplay(
      { seed_hex: record.rng_seed_hex, outcome_hash: record.outcome_hash },
      snapshot,
      input
    );
    expect(reproduced).toBe(true);
  });
});
