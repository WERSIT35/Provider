import { EngineService, type SessionSnapshot } from "../engine/engine.service";
import type { SpinInput, SpinResult } from "../engine/engine.types";
import { generateSeed, RNG_ALGO } from "../../lib/seeded-rng";
import { outcomeHash } from "../../lib/outcome-hash";

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
  constructor(private readonly engine: EngineService) {}

  resolve(snapshot: SessionSnapshot, input: SpinInput): AuthoritativeRound {
    const seedHex = generateSeed().toString("hex");
    const { result, bytesDrawn } = this.engine.resolveDeterministic(snapshot, input, seedHex);
    return {
      seed_hex: seedHex,
      rng_algo: RNG_ALGO,
      rng_bytes_drawn: bytesDrawn,
      outcome_hash: outcomeHash(result),
      result
    };
  }

  /** True iff replaying the stored seed against the same pre-spin state reproduces the outcome. */
  verifyReplay(round: Pick<AuthoritativeRound, "seed_hex" | "outcome_hash">, snapshot: SessionSnapshot, input: SpinInput): boolean {
    const { result } = this.engine.resolveDeterministic(snapshot, input, round.seed_hex);
    return outcomeHash(result) === round.outcome_hash;
  }
}
