import type { AuthoritativeRound } from "../rng/authoritative-resolver";
import type {
  RoundRepository,
  AuditRepository,
  RoundRecord,
  RoundStatus,
  RoundPreState,
  ChainVerification
} from "./ledger.types";
import { deriveFeatureFamilies } from "./feature-family";
import type { InMemoryAuditRepository, InMemoryRoundRepository } from "./memory-repositories";
import type { SignatureStatus, SignatureSummary } from "../../lib/security/signing-keyring";

/** Checks one ledger row against the key it names (SigningKeyring.verifyLedger). */
export interface LedgerVerifier {
  verifyLedger(table: "rounds" | "audit_records", row: { seq: number; chain_hash: string; signature?: string | null; signing_key_id?: string | null }): SignatureStatus;
}

export interface IntegrityReport {
  rounds: ChainVerification;
  audit: ChainVerification;
  /** Per-row Ed25519 signatures (migration 0012); present when a keyring is wired. */
  signatures?: { rounds: SignatureSummary; audit: SignatureSummary };
}

/** Context the platform supplies alongside the engine outcome to record a round. */
export interface RoundContext {
  round_ref: string;
  session_id: string;
  operator_id: string;
  operator_player_id: string;
  game_id: string;
  math_config_id: string;
  bet_amount: number;
  /** Actual amount debited (0 for free spins). Falls back to the engine/bet_amount if omitted. */
  bet_charged?: number;
  is_free_spin?: boolean;
  ante_enabled?: boolean;
  pre_state?: RoundPreState;
  /** Operator free round: the campaign + player grant that funded it. */
  campaign_id?: string;
  grant_id?: string;
  /** Engine version that resolved the outcome (EngineService.engineVersion()). */
  engine_version?: string;
  /** Rules payload hash the outcome was resolved with (EngineService.rulesHash()). */
  rules_hash?: string;
}

/**
 * Records server-authoritative outcomes into the immutable round ledger and writes a
 * matching audit entry. The round captures the seed + rng_algo + outcome_hash so the
 * round can later be deterministically replayed and verified (plan §5/§8).
 */
export class RoundLedgerService {
  constructor(
    private readonly rounds: RoundRepository,
    private readonly audit: AuditRepository,
    private readonly verifier?: LedgerVerifier
  ) {}

  recordResolvedRound(ctx: RoundContext, resolved: AuthoritativeRound): RoundRecord {
    const status: RoundStatus = "resolved";
    const record = this.rounds.append({
      round_ref: ctx.round_ref,
      session_id: ctx.session_id,
      operator_id: ctx.operator_id,
      operator_player_id: ctx.operator_player_id,
      game_id: ctx.game_id,
      math_config_id: ctx.math_config_id,
      bet_amount: ctx.bet_amount,
      bet_charged: Number(ctx.bet_charged ?? resolved.result.bet_charged ?? ctx.bet_amount),
      is_free_spin: Boolean(ctx.is_free_spin ?? resolved.result.is_free_spin),
      ante_enabled: Boolean(ctx.ante_enabled),
      rng_seed_hex: resolved.seed_hex,
      rng_algo: resolved.rng_algo,
      rng_bytes_drawn: resolved.rng_bytes_drawn,
      outcome_hash: resolved.outcome_hash,
      total_win: Number(resolved.result.total_win ?? 0),
      multiplier_applied: Number(resolved.result.multiplier_applied ?? 1),
      status,
      outcome: resolved.result,
      pre_state: ctx.pre_state,
      // Added ONLY when set: the payload hash covers every key, so a cash round must
      // hash exactly as it did before free rounds existed (see TableSpec.omitNull).
      ...(ctx.campaign_id ? { campaign_id: ctx.campaign_id, grant_id: ctx.grant_id } : {}),
      ...(ctx.engine_version ? { engine_version: ctx.engine_version } : {}),
      ...(ctx.rules_hash ? { rules_hash: ctx.rules_hash } : {})
    });

    this.audit.append({
      operator_id: ctx.operator_id,
      actor_type: "system",
      actor_id: "spin-resolver",
      action: "round.resolved",
      target_type: "round",
      target_id: record.round_ref
    });

    return record;
  }

  getRound(roundRef: string): RoundRecord | null {
    return this.rounds.getByRef(roundRef);
  }

  /** The most recently recorded round of a session (highest seq), or null. */
  lastRoundForSession(sessionId: string): RoundRecord | null {
    const list = this.rounds.list({ session_id: sessionId });
    return list.length ? list.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  }

  /**
   * The bonus family a round belongs to (see feature-family.ts): the trigger plus
   * its free spins in play order, and this round's position in it. null when the
   * round is not part of a bonus.
   */
  featureFamily(roundRef: string): { feature_ref: string; position: number; rounds: RoundRecord[] } | null {
    const round = this.rounds.getByRef(roundRef);
    if (!round) return null;
    const sessionRounds = this.rounds.list({ session_id: round.session_id });
    const families = deriveFeatureFamilies(sessionRounds);
    const me = families.get(roundRef);
    if (!me) return null;
    const rounds = sessionRounds
      .filter((r) => families.get(r.round_ref)?.feature_ref === me.feature_ref)
      .sort((a, b) => a.seq - b.seq);
    return { feature_ref: me.feature_ref, position: me.index, rounds };
  }

  /** The session's newest round that was not a free spin (a feature's trigger), or null. */
  lastTriggerRoundForSession(sessionId: string): RoundRecord | null {
    const list = this.rounds.list({ session_id: sessionId }).filter((r) => !r.is_free_spin);
    return list.length ? list.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  }

  /**
   * Hash chains of both ledgers, plus every row's signature unless asked not to. Checking
   * signatures costs ~75µs per row, so per-round callers (the inspector, exports) pass
   * { signatures: false } and check only their own row (roundSignature); the full sweep
   * is for GET /admin/v1/integrity.
   */
  verifyIntegrity(opts: { signatures?: boolean } = {}): IntegrityReport {
    const report: IntegrityReport = { rounds: this.rounds.verifyChain(), audit: this.audit.verifyChain() };
    if (opts.signatures === false) return report;
    const v = this.verifier;
    const rounds = this.rounds as Partial<InMemoryRoundRepository>;
    const audit = this.audit as Partial<InMemoryAuditRepository>;
    if (v && rounds.verifySignatures && audit.verifySignatures) {
      report.signatures = {
        rounds: rounds.verifySignatures((row) => v.verifyLedger("rounds", row)),
        audit: audit.verifySignatures((row) => v.verifyLedger("audit_records", row))
      };
    }
    return report;
  }

  /** One round's signature check: what the Round Inspector shows. */
  roundSignature(roundRef: string): { status: SignatureStatus; key_id: string | null } | null {
    const round = this.rounds.getByRef(roundRef);
    if (!round) return null;
    if (!this.verifier) return { status: "unsigned", key_id: round.signing_key_id ?? null };
    return { status: this.verifier.verifyLedger("rounds", round), key_id: round.signing_key_id ?? null };
  }
}
