/** Immutable ledger record + repository contracts (plan §3.3/§3.4). */

import type { SpinResult } from "../engine/engine.types";

export type RoundStatus = "resolved" | "settled" | "void";

/**
 * Full server-authoritative spin outcome stored alongside the round metadata so
 * the admin Round Inspector can replay exactly what the player saw without
 * re-running the engine (mirrors the `outcome_jsonb` column in the Postgres
 * schema). Volatile ids inside this payload are stripped before hashing, so
 * including it does NOT break the deterministic chain hash.
 */
export type StoredOutcome = SpinResult;

/**
 * The exact pre-spin state a round was resolved against. Persisting it lets the
 * verification service deterministically replay ANY round (including free spins,
 * whose outcome depends on the carried free-spin count/multiplier) rather than
 * only base spins where the pre-state is implicitly zero.
 */
export interface RoundPreState {
  game_code: string;
  /** The exact engine balance the round was resolved against (a seamless-model sentinel).
   * Captured because the engine's outcome embeds the balance, so replay must match it. */
  balance: number;
  free_spins_left: number;
  free_spin_multiplier_carry: number;
  ante_enabled: boolean;
  resolve_mode: "spin" | "buy";
}

/** Caller-supplied content of a round (everything except chain/identity fields). */
export interface RoundInput {
  round_ref: string;
  session_id: string;
  operator_id: string;
  operator_player_id: string;
  game_id: string;
  math_config_id: string;
  bet_amount: number;
  bet_charged: number;
  is_free_spin: boolean;
  ante_enabled: boolean;
  rng_seed_hex: string;
  rng_algo: string;
  rng_bytes_drawn: number;
  outcome_hash: string;
  total_win: number;
  multiplier_applied: number;
  status: RoundStatus;
  outcome: StoredOutcome;
  /** Optional for rounds recorded before pre-state capture; verification is inconclusive without it. */
  pre_state?: RoundPreState;
}

export interface RoundRecord extends RoundInput {
  id: string;
  seq: number;
  created_at: string;
  prev_hash: string;
  payload_hash: string;
  chain_hash: string;
}

export interface AuditInput {
  operator_id: string | null;
  actor_type: "admin" | "system" | "operator";
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
}

export interface AuditRecord extends AuditInput {
  id: string;
  seq: number;
  created_at: string;
  prev_hash: string;
  payload_hash: string;
  chain_hash: string;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  brokenAtSeq?: number;
  reason?: string;
}

export interface RoundFilter {
  operator_id?: string;
  operator_player_id?: string;
  session_id?: string;
  status?: RoundStatus;
}

/** Append-only round ledger. Intentionally exposes no update/delete. */
export interface RoundRepository {
  append(input: RoundInput): RoundRecord;
  getByRef(roundRef: string): RoundRecord | null;
  list(filter?: RoundFilter): RoundRecord[];
  verifyChain(): ChainVerification;
  size(): number;
}

/** Append-only audit log. */
export interface AuditRepository {
  append(input: AuditInput): AuditRecord;
  list(filter?: { operator_id?: string | null; action?: string }): AuditRecord[];
  verifyChain(): ChainVerification;
  size(): number;
}
