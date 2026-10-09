import { createHash } from "node:crypto";
import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { InMemoryTransactionStore } from "../wallet/transaction-store";
import type { InMemoryRoundAdjustmentStore } from "./round-adjustment.store";
import type { RoundVerificationService } from "./round-verification.service";
import type { ManagementService } from "../management/management.service";
import { streamBytes } from "../../lib/seeded-rng";
import type { ExportSigner, ExportSignature } from "../../lib/security/export-signer";

export const ROUND_EXPORT_FORMAT = "vault20k.round-export/v1";

/**
 * Signed round-history export for player disputes (GET /operator/v1/rounds/:ref/export).
 *
 * One JSON bundle with everything needed to check a round independently of the platform:
 *   round          what was played (terms, result totals, effective status)
 *   rng            seed + SHA-256 of the seed, and SHA-256 of the exact bytes the round
 *                  drew (rng_bytes_drawn of HMAC-SHA256-CTR(seed)): anyone can rebuild
 *                  that stream from the seed (qa/rng-certification-notes.md §3)
 *   outcome        pre-spin state, the full engine result and its outcome_hash
 *   verification   the platform's replay verdict (seed + pre-state → same outcome hash)
 *                  and the hash-chain check
 *   ledger         the round's link in the append-only hash chain
 *   wallet         every money move for the round (debit / credit / rollback, failed too)
 *   adjustments    provider void / settle actions on it
 * …signed with Ed25519 over its canonical JSON (ExportSigner). Only the round's own
 * operator can export it.
 */
export interface RoundExport {
  bundle: Record<string, unknown>;
  signature: ExportSignature;
}

export class RoundExportService {
  constructor(
    private readonly ledger: RoundLedgerService,
    private readonly transactions: InMemoryTransactionStore,
    private readonly adjustments: InMemoryRoundAdjustmentStore,
    private readonly verification: RoundVerificationService,
    private readonly mgmt: ManagementService,
    private readonly signer: ExportSigner,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** null when the round does not exist or belongs to another operator. */
  export(roundRef: string, operatorId: string): RoundExport | null {
    const round = this.ledger.getRound(roundRef);
    if (!round || round.operator_id !== operatorId) return null;
    const seed = Buffer.from(round.rng_seed_hex, "hex");
    const verdict = this.verification.verify(roundRef, { withResult: true });
    const game = this.mgmt.listGames().find((g) => g.id === round.game_id);
    const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

    const bundle: Record<string, unknown> = {
      format: ROUND_EXPORT_FORMAT,
      issued_at: this.now().toISOString(),
      round: {
        round_ref: round.round_ref,
        created_at: round.created_at,
        operator_player_id: round.operator_player_id,
        session_id: round.session_id,
        game_code: game?.code ?? null,
        game_id: round.game_id,
        math_config_id: round.math_config_id,
        bet_amount: round.bet_amount,
        bet_charged: round.bet_charged,
        ante_enabled: round.ante_enabled,
        is_free_spin: round.is_free_spin,
        total_win: round.total_win,
        multiplier_applied: round.multiplier_applied,
        recorded_status: round.status,
        effective_status: this.adjustments.effectiveStatus(round.round_ref, round.status),
        campaign_id: round.campaign_id ?? null,
        grant_id: round.grant_id ?? null,
        // W3C trace of the request that recorded the round (null before migration 0011):
        // the key to the request logs and the casino's own webhook rows.
        trace_id: round.trace_id ?? null
      },
      rng: {
        algo: round.rng_algo,
        seed_hex: round.rng_seed_hex,
        seed_sha256: sha256(seed),
        bytes_drawn: round.rng_bytes_drawn,
        stream_sha256: sha256(streamBytes(seed, round.rng_bytes_drawn)),
        engine_version: round.engine_version ?? null,
        rules_hash: round.rules_hash ?? null
      },
      // The result as the engine produced it. When the replay reproduced the stored hash,
      // ship the REPLAYED result: its key order is the engine's, which outcome_hash is
      // computed over, whereas a copy reloaded from Postgres jsonb has its keys reordered.
      outcome: {
        outcome_hash: round.outcome_hash,
        pre_state: round.pre_state ?? null,
        result: verdict?.outcome_ok ? verdict.replayed_result : round.outcome
      },
      verification: verdict
        ? { verdict: verdict.verdict, outcome_ok: verdict.outcome_ok, chain_ok: verdict.chain_ok, recomputed_hash: verdict.recomputed_hash, notes: verdict.notes }
        : null,
      ledger: { seq: round.seq, prev_hash: round.prev_hash, payload_hash: round.payload_hash, chain_hash: round.chain_hash },
      wallet: this.transactions.list({ round_ref: round.round_ref }).map((t) => ({
        seq: t.seq,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        status: t.status,
        error_code: t.error_code ?? null,
        idempotency_key: t.idempotency_key,
        operator_tx_ref: t.operator_tx_ref ?? null,
        trace_id: t.trace_id ?? null,
        created_at: t.created_at
      })),
      adjustments: this.adjustments.list({ round_ref: round.round_ref }).map((a) => ({
        kind: a.kind,
        effective_status: a.effective_status,
        reason: a.reason,
        actor_id: a.actor_id,
        wallet_tx_refs: a.wallet_tx_refs,
        created_at: a.created_at
      }))
    };
    return { bundle, signature: this.signer.sign(bundle) };
  }
}
