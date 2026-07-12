import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { AuditRepository, RoundStatus } from "../ledger/ledger.types";
import type { InMemoryTransactionStore, TxRecord } from "../wallet/transaction-store";
import type { WalletAdapter } from "../wallet/wallet.types";
import type { InMemoryRoundAdjustmentStore } from "./round-adjustment.store";

/**
 * Provider-executed manual round lifecycle actions (operators can only *request*
 * these via the dispute queue). Two operations:
 *
 *   void   — nullify a round: refund the bet (reverse the debit) and claw back any
 *            paid win, returning the player to their pre-round balance.
 *   settle — pay an owed win whose original credit failed (e.g. the operator wallet
 *            was unreachable during a network drop). Retries the credit and clears
 *            the round from the failed-settlement queue.
 *
 * The round ledger stays immutable; each action appends a compensating wallet
 * transaction, a round-adjustment overlay (the new effective status), and an audit
 * record. Every action is idempotent on repeat.
 */
export interface LifecycleResult {
  round_ref: string;
  action: "void" | "settle";
  effective_status: RoundStatus;
  wallet_tx_refs: string[];
  already: boolean;
  notes: string[];
}

export class RoundLifecycleService {
  constructor(
    private readonly ledger: RoundLedgerService,
    private readonly wallet: WalletAdapter,
    private readonly transactions: InMemoryTransactionStore,
    private readonly adjustments: InMemoryRoundAdjustmentStore,
    private readonly audit: AuditRepository
  ) {}

  async voidRound(roundRef: string, actorId: string, reason: string): Promise<LifecycleResult> {
    const round = this.ledger.getRound(roundRef);
    if (!round) throw new Error("ROUND_NOT_FOUND");

    if (this.adjustments.effectiveStatus(roundRef, round.status) === "void") {
      return { round_ref: roundRef, action: "void", effective_status: "void", wallet_tx_refs: [], already: true, notes: ["already voided"] };
    }

    const txs = this.transactions.list({ round_ref: roundRef });
    const ctx = { operatorId: round.operator_id };
    const walletRefs: string[] = [];
    const notes: string[] = [];

    // 1) Refund the bet by reversing the original confirmed debit.
    const debit = txs.find((t) => t.type === "DEBIT" && t.status === "confirmed");
    if (debit?.operator_tx_ref) {
      const rb = await this.wallet.rollback(ctx, {
        idempotencyKey: `${roundRef}:void:rollback`,
        originalOperatorTxRef: debit.operator_tx_ref,
        roundRef
      });
      walletRefs.push(rb.operatorTxRef);
      this.transactions.record({
        operator_id: round.operator_id,
        session_id: round.session_id,
        round_ref: roundRef,
        type: "ROLLBACK",
        amount: debit.amount,
        currency: debit.currency,
        idempotency_key: `${roundRef}:void:rollback`,
        operator_tx_ref: rb.operatorTxRef,
        status: "rolled_back"
      });
      notes.push(`refunded bet ${debit.amount} ${debit.currency}`);
    } else {
      notes.push("no confirmed debit to refund (free spin or already reversed)");
    }

    // 2) Claw back any paid win via a compensating debit.
    const credit = txs.find((t) => t.type === "CREDIT" && t.status === "confirmed");
    if (credit && credit.amount > 0) {
      try {
        const claw = await this.wallet.debit(ctx, {
          idempotencyKey: `${roundRef}:void:clawback`,
          roundRef,
          operatorPlayerId: round.operator_player_id,
          amount: credit.amount,
          currency: credit.currency
        });
        walletRefs.push(claw.operatorTxRef);
        this.transactions.record({
          operator_id: round.operator_id,
          session_id: round.session_id,
          round_ref: roundRef,
          type: "ADJUSTMENT",
          amount: credit.amount,
          currency: credit.currency,
          idempotency_key: `${roundRef}:void:clawback`,
          operator_tx_ref: claw.operatorTxRef,
          status: "confirmed"
        });
        notes.push(`clawed back win ${credit.amount} ${credit.currency}`);
      } catch {
        this.transactions.record({
          operator_id: round.operator_id,
          session_id: round.session_id,
          round_ref: roundRef,
          type: "ADJUSTMENT",
          amount: credit.amount,
          currency: credit.currency,
          idempotency_key: `${roundRef}:void:clawback`,
          status: "failed",
          error_code: "CLAWBACK_FAILED"
        });
        notes.push("clawback FAILED (insufficient player funds) — flagged for ops");
      }
    }

    this.adjustments.append({
      round_ref: roundRef,
      operator_id: round.operator_id,
      operator_player_id: round.operator_player_id,
      kind: "void",
      effective_status: "void",
      reason,
      actor_id: actorId,
      wallet_tx_refs: walletRefs
    });
    this.audit.append({
      operator_id: round.operator_id,
      actor_type: "admin",
      actor_id: actorId,
      action: "round.void",
      target_type: "round",
      target_id: roundRef
    });

    return { round_ref: roundRef, action: "void", effective_status: "void", wallet_tx_refs: walletRefs, already: false, notes };
  }

  async settleRound(roundRef: string, actorId: string, reason: string): Promise<LifecycleResult> {
    const round = this.ledger.getRound(roundRef);
    if (!round) throw new Error("ROUND_NOT_FOUND");
    if (this.adjustments.effectiveStatus(roundRef, round.status) === "void") {
      throw new Error("CANNOT_SETTLE_VOID_ROUND");
    }

    const txs = this.transactions.list({ round_ref: roundRef });
    const confirmedCredit = txs.find((t) => t.type === "CREDIT" && t.status === "confirmed");
    if (confirmedCredit) {
      return { round_ref: roundRef, action: "settle", effective_status: "settled", wallet_tx_refs: [], already: true, notes: ["win already paid"] };
    }

    const failedCredit = txs.find((t) => t.type === "CREDIT" && t.status === "failed");
    if (!failedCredit) throw new Error("NO_PENDING_SETTLEMENT");

    const ctx = { operatorId: round.operator_id };
    const credit = await this.wallet.credit(ctx, {
      idempotencyKey: `${roundRef}:settle:credit`,
      roundRef,
      operatorPlayerId: round.operator_player_id,
      amount: failedCredit.amount,
      currency: failedCredit.currency
    });
    this.transactions.record({
      operator_id: round.operator_id,
      session_id: round.session_id,
      round_ref: roundRef,
      type: "CREDIT",
      amount: failedCredit.amount,
      currency: failedCredit.currency,
      idempotency_key: `${roundRef}:settle:credit`,
      operator_tx_ref: credit.operatorTxRef,
      status: "confirmed"
    });
    this.adjustments.append({
      round_ref: roundRef,
      operator_id: round.operator_id,
      operator_player_id: round.operator_player_id,
      kind: "settle",
      effective_status: "settled",
      reason,
      actor_id: actorId,
      wallet_tx_refs: [credit.operatorTxRef]
    });
    this.audit.append({
      operator_id: round.operator_id,
      actor_type: "admin",
      actor_id: actorId,
      action: "round.settle",
      target_type: "round",
      target_id: roundRef
    });

    return {
      round_ref: roundRef,
      action: "settle",
      effective_status: "settled",
      wallet_tx_refs: [credit.operatorTxRef],
      already: false,
      notes: [`paid owed win ${failedCredit.amount} ${failedCredit.currency}`]
    };
  }
}
