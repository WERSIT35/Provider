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
  /** Feature-round running win before this spin (max-win cap state). Absent on older rounds = 0. */
  bonus_round_win?: number;
  ante_enabled: boolean;
  resolve_mode: "spin" | "buy";
  /**
   * Stateful games only (never present on a Vault 20K round, so its payload hash keys
   * are unchanged): the session's feature state, the player's state at this bet, and the
   * player's pick, exactly as the round was resolved with them.
   */
  feature_state?: unknown;
  player_state?: unknown;
  choice?: number;
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
  /** Operator free round only (absent on cash rounds — never null; see TableSpec.omitNull). */
  campaign_id?: string;
  grant_id?: string;
  /** Engine version that resolved the round (absent on rounds recorded before versioning). */
  engine_version?: string;
  /** SHA-256 of the canonical rules payload that resolved the round (absent on older rounds). */
  rules_hash?: string;
  /**
   * W3C trace id of the request that recorded the round (src/lib/trace-context.ts);
   * filled from the current trace on append. Absent on rounds recorded before 0011.
   */
  trace_id?: string;
}

/**
 * Ed25519 signature over a ledger row (signing-keyring.ts ledgerMessage) and the key that
 * made it. Outside the hashed payload: added after chain_hash is computed. Absent on rows
 * recorded before migration 0012.
 */
export interface RowSignature {
  signature?: string;
  signing_key_id?: string;
}

export interface RoundRecord extends RoundInput, RowSignature {
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
  /** W3C trace id of the request that wrote the entry; absent outside a request (jobs) and before 0011. */
  trace_id?: string;
}

export interface AuditRecord extends AuditInput, RowSignature {
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
