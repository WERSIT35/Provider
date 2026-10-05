import type { AuditRepository } from "../ledger/ledger.types";
import { DEBIT_OUTCOME_UNKNOWN, type InMemoryTransactionStore, type TxRecord, type TxType } from "./transaction-store";
import { type WalletAdapter, type WalletContext, type DebitArgs, type WalletTxResult, isOutcomeUnknown } from "./wallet.types";

/** The RGS round a debit belongs to (what the transaction ledger records it under). */
export interface DebitMeta {
  operator_id: string;
  session_id: string;
  type: TxType; // DEBIT or FREE_ROUND_BET
  campaign_id?: string;
}

export interface SweepResult {
  reversed: number;
  pending: number;
}

/**
 * Lost-debit reconciliation (the "stake stranded at the casino" gap).
 *
 * A debit whose response never arrives may or may not have been applied by the casino,
 * and the round cannot be played on a maybe. So:
 *
 *  1. retry the debit IN LINE under the same idempotency key (a transient loss, the
 *     common case: the casino replays its original answer and the round goes ahead,
 *     debited once);
 *  2. still unknown → VOID the round: record the debit as DEBIT_OUTCOME_UNKNOWN and
 *     send a rollback addressed by the debit's idempotency key. The casino refunds the
 *     debit if it has it, or tombstones the key so a late-arriving debit is refused;
 *  3. the casino unreachable for that too → the reversal stays queued
 *     (listPendingReversals) and sweep() — the background job — retries it until the
 *     casino acknowledges.
 *
 * A voided round stays voided: a client retry under the same key is refused
 * (ROUND_VOIDED) instead of debiting again, so a round can never be played while its
 * stake is being refunded.
 */
export class DebitReconciler {
  private readonly sweeping = new Set<string>();

  constructor(
    private readonly wallet: WalletAdapter,
    private readonly transactions: InMemoryTransactionStore,
    private readonly opts: { retryDelaysMs?: number[]; audit?: AuditRepository } = {}
  ) {}

  /** True when this debit key belongs to a round already voided by reconciliation. */
  isVoided(debitKey: string): boolean {
    const tx = this.transactions.getByKey(debitKey);
    return Boolean(tx && tx.status === "failed" && tx.error_code === DEBIT_OUTCOME_UNKNOWN);
  }

  /**
   * Debit with in-line retries. Resolves with the casino's confirmation, rethrows a
   * definite decline, and on an outcome that stays unknown voids the round and throws
   * DEBIT_UNCONFIRMED (the reversal is sent now, or queued).
   */
  async debit(ctx: WalletContext, args: DebitArgs, meta: DebitMeta): Promise<WalletTxResult> {
    if (this.isVoided(args.idempotencyKey)) throw new Error("ROUND_VOIDED");
    const delays = this.opts.retryDelaysMs ?? [250, 1000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      try {
        return await this.wallet.debit(ctx, args);
      } catch (err) {
        if (!isOutcomeUnknown(err)) throw err;
      }
    }

    const tx = this.transactions.record({
      operator_id: meta.operator_id,
      session_id: meta.session_id,
      round_ref: args.roundRef,
      type: meta.type,
      amount: args.amount,
      currency: args.currency,
      idempotency_key: args.idempotencyKey,
      status: "failed",
      error_code: DEBIT_OUTCOME_UNKNOWN,
      ...(meta.campaign_id ? { campaign_id: meta.campaign_id } : {})
    });
    this.opts.audit?.append({
      operator_id: meta.operator_id,
      actor_type: "system",
      actor_id: "debit-reconciler",
      action: "round.void_unconfirmed_debit",
      target_type: "round",
      target_id: args.roundRef
    });
    await this.reverse(tx, args.operatorPlayerId); // false = queued for the sweep
    throw new Error("DEBIT_UNCONFIRMED");
  }

  /**
   * Send (or re-send) the reversal for one unknown debit. Same rollback key every
   * time, so the casino refunds at most once however often this runs. True once the
   * casino has acknowledged.
   */
  async reverse(debit: TxRecord, operatorPlayerId?: string): Promise<boolean> {
    const rollbackKey = `${debit.idempotency_key}:reverse`;
    if (this.transactions.getByKey(rollbackKey)) return true;
    if (this.sweeping.has(rollbackKey)) return false;
    this.sweeping.add(rollbackKey);
    try {
      const rb = await this.wallet.rollback(
        { operatorId: debit.operator_id },
        {
          idempotencyKey: rollbackKey,
          originalIdempotencyKey: debit.idempotency_key,
          roundRef: debit.round_ref,
          ...(operatorPlayerId ? { operatorPlayerId } : {}),
          amount: debit.amount,
          currency: debit.currency
        }
      );
      this.transactions.record({
        operator_id: debit.operator_id,
        session_id: debit.session_id,
        round_ref: debit.round_ref,
        type: "ROLLBACK",
        amount: debit.amount,
        currency: debit.currency,
        idempotency_key: rollbackKey,
        operator_tx_ref: rb.operatorTxRef,
        status: "rolled_back",
        ...(debit.campaign_id ? { campaign_id: debit.campaign_id } : {})
      });
      return true;
    } catch {
      return false; // still unreachable: stays in the queue for the next sweep
    } finally {
      this.sweeping.delete(rollbackKey);
    }
  }

  /** One pass over the queue (the background job). */
  async sweep(operatorPlayerIdFor?: (tx: TxRecord) => string | undefined): Promise<SweepResult> {
    let reversed = 0;
    for (const tx of this.transactions.listPendingReversals()) {
      if (await this.reverse(tx, operatorPlayerIdFor?.(tx))) reversed += 1;
    }
    return { reversed, pending: this.transactions.listPendingReversals().length };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
