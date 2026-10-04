import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { AuthoritativeResolver } from "../rng/authoritative-resolver";

/**
 * "Was this win legitimate?" — the dispute-resolution backbone.
 *
 * A recorded round stores the server seed, the pre-spin state, and the canonical
 * outcome hash. This service re-derives the outcome from the seed + pre-state and
 * confirms it reproduces the stored hash, and independently checks the ledger's
 * hash-chain integrity. Together they answer two distinct questions:
 *   - outcome_ok: the stored outcome is exactly what the seed produces (not forged)
 *   - chain_ok:   the stored round has not been retroactively edited
 *
 * Verdict:
 *   legitimate    — both checks pass
 *   tampered      — either check fails (outcome forged or ledger edited)
 *   inconclusive  — round predates pre-state capture, or it was resolved by a different
 *                   engine version than the one running, so it can't be replayed here
 */
export type Verdict = "legitimate" | "tampered" | "inconclusive";

export interface VerificationResult {
  round_ref: string;
  verdict: Verdict;
  outcome_ok: boolean | null;
  chain_ok: boolean;
  stored_hash: string;
  recomputed_hash: string | null;
  chain: { seq: number; prev_hash: string; payload_hash: string; chain_hash: string };
  notes: string[];
}

export class RoundVerificationService {
  constructor(
    private readonly ledger: RoundLedgerService,
    private readonly resolver: AuthoritativeResolver
  ) {}

  /** Returns null when the round does not exist (caller maps to 404). */
  verify(roundRef: string): VerificationResult | null {
    const round = this.ledger.getRound(roundRef);
    if (!round) return null;

    const chain = this.ledger.verifyIntegrity().rounds;
    const chain_ok = chain.ok;
    const notes: string[] = [];
    if (!chain_ok) {
      notes.push(`ledger chain broken at seq ${chain.brokenAtSeq} (${chain.reason})`);
    }

    if (!round.pre_state) {
      notes.push("round predates pre-state capture — deterministic replay not possible");
      return {
        round_ref: round.round_ref,
        verdict: chain_ok ? "inconclusive" : "tampered",
        outcome_ok: null,
        chain_ok,
        stored_hash: round.outcome_hash,
        recomputed_hash: null,
        chain: {
          seq: round.seq,
          prev_hash: round.prev_hash,
          payload_hash: round.payload_hash,
          chain_hash: round.chain_hash
        },
        notes
      };
    }

    const replay = this.resolver.verifyReplayDetailed(
      { seed_hex: round.rng_seed_hex, outcome_hash: round.outcome_hash },
      {
        gameId: round.pre_state.game_code,
        balance: round.pre_state.balance,
        freeSpinsLeft: round.pre_state.free_spins_left,
        freeSpinPersistentMultiplier: round.pre_state.free_spin_multiplier_carry,
        bonusRoundWin: round.pre_state.bonus_round_win ?? 0,
        anteEnabled: round.pre_state.ante_enabled
      },
      { bet_amount: round.bet_amount, ante_enabled: round.ante_enabled },
      round.pre_state.resolve_mode
    );
    // A seed only reproduces its outcome under the engine version that resolved it.
    // When the running engine differs, a hash mismatch proves nothing either way, so
    // the verdict is inconclusive (the chain check still guards against edits — the
    // recorded engine_version is itself covered by the chain hash).
    const currentEngine = this.resolver.engineVersion();
    const engineMismatch = round.engine_version !== currentEngine;
    if (!replay.ok) {
      notes.push("recomputed outcome hash does not match the stored hash");
      if (engineMismatch) {
        notes.push(
          round.engine_version
            ? `round was resolved by engine ${round.engine_version}; this platform runs ${currentEngine} — replay needs engine ${round.engine_version}`
            : `round predates engine versioning; this platform runs ${currentEngine} and the engine may have changed since`
        );
      }
    }

    return {
      round_ref: round.round_ref,
      verdict: !chain_ok ? "tampered" : replay.ok ? "legitimate" : engineMismatch ? "inconclusive" : "tampered",
      outcome_ok: replay.ok,
      chain_ok,
      stored_hash: round.outcome_hash,
      recomputed_hash: replay.recomputed_hash,
      chain: {
        seq: round.seq,
        prev_hash: round.prev_hash,
        payload_hash: round.payload_hash,
        chain_hash: round.chain_hash
      },
      notes
    };
  }
}
