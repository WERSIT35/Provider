import type { ChainVerification } from "../ledger/ledger.types";
import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { AuthoritativeResolver } from "../rng/authoritative-resolver";
import type { SignatureStatus } from "../../lib/security/signing-keyring";

/**
 * "Was this win legitimate?" — the dispute-resolution backbone.
 *
 * A recorded round stores the server seed, the pre-spin state, and the canonical
 * outcome hash. This service re-derives the outcome from the seed + pre-state and
 * confirms it reproduces the stored hash, and independently checks the ledger's
 * hash-chain integrity. Together they answer two distinct questions:
 *   - outcome_ok: the stored outcome is exactly what the seed produces (not forged)
 *   - chain_ok:   the stored round has not been retroactively edited
 *   - signature:  the row carries a valid Ed25519 signature by a platform key. The hash
 *                 chain cannot stop a full rewrite by someone with database access (who
 *                 recomputes every hash); a signature needs the private key.
 *
 * Verdict:
 *   legitimate    — both checks pass
 *   tampered      — any check fails (outcome forged, ledger edited, or the row's
 *                   signature invalid or by a key the platform never had)
 *   inconclusive  — round predates pre-state capture, or it was resolved by a different
 *                   engine version or rules payload than the one running, so it can't
 *                   be replayed here
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
  /** The round row's Ed25519 signature check (unsigned = recorded before migration 0012). */
  signature: { status: SignatureStatus; key_id: string | null };
  notes: string[];
  /** The replayed engine result (original key order), only with verify(ref, { withResult: true }). */
  replayed_result?: unknown;
}

export class RoundVerificationService {
  constructor(
    private readonly ledger: RoundLedgerService,
    private readonly resolver: AuthoritativeResolver,
    /**
     * The chain check for one round. Default: the whole rounds chain (memory mode holds
     * it all). Postgres mode passes the round's own links + the last full sweep
     * (PgHistory.roundChainHeld), so an inspector open is not O(history).
     */
    private readonly chainFor: (roundRef: string) => ChainVerification = () => this.ledger.verifyIntegrity({ signatures: false }).rounds
  ) {}

  /** Returns null when the round does not exist (caller maps to 404). */
  verify(roundRef: string, opts: { withResult?: boolean } = {}): VerificationResult | null {
    const round = this.ledger.getRound(roundRef);
    if (!round) return null;

    // This round's own signature is checked below; no full signature sweep per round.
    const chainCheck = this.chainFor(roundRef);
    const notes: string[] = [];
    if (!chainCheck.ok) {
      notes.push(`ledger chain broken at seq ${chainCheck.brokenAtSeq} (${chainCheck.reason})`);
    }
    const signature = this.ledger.roundSignature(roundRef) ?? { status: "unsigned" as const, key_id: null };
    const signatureBad = signature.status === "invalid" || signature.status === "unknown_key";
    if (signature.status === "invalid") notes.push(`row signature does not verify with key ${signature.key_id}`);
    if (signature.status === "unknown_key") notes.push(`row is signed by ${signature.key_id}, a key this platform never had`);
    if (signature.status === "unsigned") notes.push("row predates per-row signatures (migration 0012); the hash chain still covers it");
    // A bad signature fails integrity exactly like a broken chain.
    const chain_ok = chainCheck.ok && !signatureBad;

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
        signature,
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
    // A seed only reproduces its outcome under the engine version AND the rules payload
    // that resolved it. When either differs from what this platform runs (or the round
    // predates recording it), a hash mismatch proves nothing either way, so the verdict
    // is inconclusive. The chain check still guards against edits: the recorded
    // engine_version and rules_hash are themselves covered by the chain hash.
    const currentEngine = this.resolver.engineVersion(round.pre_state.game_code);
    const currentRules = this.resolver.rulesHash(round.pre_state.game_code);
    const engineMismatch = round.engine_version !== currentEngine;
    const rulesMismatch = round.rules_hash !== currentRules;
    if (!replay.ok) {
      notes.push("recomputed outcome hash does not match the stored hash");
      if (engineMismatch) {
        notes.push(
          round.engine_version
            ? `round was resolved by engine ${round.engine_version}; this platform runs ${currentEngine} — replay needs engine ${round.engine_version}`
            : `round predates engine versioning; this platform runs ${currentEngine} and the engine may have changed since`
        );
      }
      if (rulesMismatch) {
        notes.push(
          round.rules_hash
            ? `round was resolved with rules ${round.rules_hash.slice(0, 12)}…; this platform runs rules ${currentRules.slice(0, 12)}… — replay needs the original rules payload`
            : `round predates rules hashing; this platform runs rules ${currentRules.slice(0, 12)}… and the rules may have changed since`
        );
      }
    }
    const replayable = !engineMismatch && !rulesMismatch;

    return {
      round_ref: round.round_ref,
      verdict: !chain_ok ? "tampered" : replay.ok ? "legitimate" : replayable ? "tampered" : "inconclusive",
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
      signature,
      notes,
      ...(opts.withResult ? { replayed_result: replay.result } : {})
    };
  }
}
