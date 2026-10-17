import type { EngineService, EngineSource, SessionSnapshot } from "../engine/engine.service";
import type { SpinInput, SpinResult } from "../engine/engine.types";
import { generateSeed, RNG_ALGO } from "../../lib/seeded-rng";
import { outcomeHash } from "../../lib/outcome-hash";
import { metrics } from "../../lib/metrics";

/** The reproducible record of one resolved round (the data the ledger persists). */
export interface AuthoritativeRound {
  seed_hex: string;
  rng_algo: string;
  rng_bytes_drawn: number;
  outcome_hash: string;
  result: SpinResult;
}

/**
 * Server-authoritative spin resolution. Draws a fresh server seed, resolves the
 * outcome deterministically under that seed, and hashes the canonical outcome.
 * `verifyReplay` re-runs the stored seed against the same pre-spin state and
 * confirms it reproduces the stored hash — the auditability guarantee from plan §5/§8.
 */
export class AuthoritativeResolver {
  /** One game's engine, or the GameRegistry (each round resolves with its session's game). */
  constructor(private readonly engines: EngineSource) {}

  /** Version of the engine this resolver replays a game's rounds with (none = Vault 20K). */
  engineVersion(gameCode?: string | null): string {
    return this.engines.engineFor(gameCode).engineVersion();
  }

  /** Hash of the rules payload this resolver replays a game's rounds with. */
  rulesHash(gameCode?: string | null): string {
    return this.engines.engineFor(gameCode).rulesHash();
  }

  /** The engine of the snapshot's game (its session game code; an RTP variant included). */
  private engineOf(snapshot: SessionSnapshot): EngineService {
    return this.engines.engineFor(snapshot.gameId);
  }

  resolve(snapshot: SessionSnapshot, input: SpinInput): AuthoritativeRound {
    const seedHex = generateSeed().toString("hex");
    const engine = this.engineOf(snapshot);
    const { result, bytesDrawn } = engine.resolveDeterministic(snapshot, input, seedHex);
    this.assertPayable(engine, result, input, "spin");
    return {
      seed_hex: seedHex,
      rng_algo: RNG_ALGO,
      rng_bytes_drawn: bytesDrawn,
      outcome_hash: outcomeHash(result),
      result
    };
  }

  /** Server-authoritative Buy-Free-Spins resolution (forces the bonus trigger). */
  resolveBuy(snapshot: SessionSnapshot, input: SpinInput): AuthoritativeRound {
    const seedHex = generateSeed().toString("hex");
    const engine = this.engineOf(snapshot);
    const { result, bytesDrawn } = engine.resolveDeterministicBuy(snapshot, input, seedHex);
    this.assertPayable(engine, result, input, "buy");
    return {
      seed_hex: seedHex,
      rng_algo: RNG_ALGO,
      rng_bytes_drawn: bytesDrawn,
      outcome_hash: outcomeHash(result),
      result
    };
  }

  /**
   * Fail-closed check on every result before it can be recorded or paid. Each of these
   * "cannot happen" through the RGS (engine.service.ts engineInput pins the engine's
   * dev inputs off); if one ever does, the round is refused. Throwing here takes the
   * orchestrator's resolve-failure path: the debit is rolled back and nothing is
   * recorded or credited. rgs_engine_integrity_violations_total must stay 0.
   */
  private assertPayable(engine: EngineService, result: SpinResult, input: SpinInput, mode: "spin" | "buy"): void {
    const fail = (check: string, detail: string): never => {
      metrics.engineIntegrity.inc({ check });
      throw new Error(`ENGINE_INTEGRITY:${check}: ${detail}`);
    };
    if (result.crazy_mode === true) fail("crazy_mode", "crazy mode is never allowed on a paid round");
    if (Number(result.bet_amount) !== input.bet_amount) fail("bet_amount", `result bet ${result.bet_amount} != requested ${input.bet_amount}`);
    if (mode === "spin" && !result.is_free_spin && Boolean(result.ante_enabled) !== Boolean(input.ante_enabled)) {
      fail("ante", `result ante ${result.ante_enabled} != requested ${Boolean(input.ante_enabled)}`);
    }
    const win = Number(result.total_win);
    // The cap covers a whole feature round, so no single round can pay more than it.
    const cap = engine.maxWinMultiplier() * input.bet_amount;
    if (!Number.isFinite(win) || win < 0 || win > cap + 1e-6) fail("total_win", `win ${result.total_win} outside [0, ${cap}]`);
  }

  /** True iff replaying the stored seed against the same pre-spin state reproduces the outcome. */
  verifyReplay(round: Pick<AuthoritativeRound, "seed_hex" | "outcome_hash">, snapshot: SessionSnapshot, input: SpinInput): boolean {
    return this.verifyReplayDetailed(round, snapshot, input, "spin").ok;
  }

  /**
   * Mode-aware replay used by the admin verification tool. Re-resolves the stored
   * seed through the same code path the round was originally resolved on ("spin" or
   * the forced-trigger "buy"), and returns the recomputed hash alongside the verdict
   * so the caller can surface the exact mismatch on a dispute.
   */
  verifyReplayDetailed(
    round: Pick<AuthoritativeRound, "seed_hex" | "outcome_hash">,
    snapshot: SessionSnapshot,
    input: SpinInput,
    mode: "spin" | "buy"
  ): { ok: boolean; recomputed_hash: string; result: SpinResult } {
    const engine = this.engineOf(snapshot);
    const { result } =
      mode === "buy"
        ? engine.resolveDeterministicBuy(snapshot, input, round.seed_hex)
        : engine.resolveDeterministic(snapshot, input, round.seed_hex);
    const recomputed_hash = outcomeHash(result);
    return { ok: recomputed_hash === round.outcome_hash, recomputed_hash, result };
  }
}
