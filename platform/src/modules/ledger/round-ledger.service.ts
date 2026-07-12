import type { AuthoritativeRound } from "../rng/authoritative-resolver";
import type {
  RoundRepository,
  AuditRepository,
  RoundRecord,
  RoundStatus,
  RoundPreState,
  ChainVerification
} from "./ledger.types";

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
}

/**
 * Records server-authoritative outcomes into the immutable round ledger and writes a
 * matching audit entry. The round captures the seed + rng_algo + outcome_hash so the
 * round can later be deterministically replayed and verified (plan §5/§8).
 */
export class RoundLedgerService {
  constructor(
    private readonly rounds: RoundRepository,
    private readonly audit: AuditRepository
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
      pre_state: ctx.pre_state
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

  verifyIntegrity(): { rounds: ChainVerification; audit: ChainVerification } {
    return { rounds: this.rounds.verifyChain(), audit: this.audit.verifyChain() };
  }
}
