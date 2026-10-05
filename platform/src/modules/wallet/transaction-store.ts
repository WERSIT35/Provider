import { randomUUID } from "node:crypto";
import { NullPersistence, type Persistence } from "../../persistence/persistence";
import { currentTrace } from "../../lib/trace-context";

/** Money-movement ledger (plan §3.3 wallet_transactions). Append-only + idempotent
 * by idempotency_key. Feeds reporting, reconciliation, and the failed-settlement queue. */

export type TxType = "DEBIT" | "CREDIT" | "ROLLBACK" | "ADJUSTMENT" | "FREE_ROUND_BET" | "FREE_ROUND_WIN";

/** Types that take a round's stake / pay a round's win (cash or operator free round). */
export const BET_TX_TYPES: ReadonlySet<TxType> = new Set<TxType>(["DEBIT", "FREE_ROUND_BET"]);
export const WIN_TX_TYPES: ReadonlySet<TxType> = new Set<TxType>(["CREDIT", "FREE_ROUND_WIN"]);
export type TxStatus = "confirmed" | "failed" | "rolled_back";

/** error_code of a debit the casino may or may not have applied (see DebitReconciler). */
export const DEBIT_OUTCOME_UNKNOWN = "DEBIT_OUTCOME_UNKNOWN";

export interface TxInput {
  operator_id: string;
  session_id: string;
  round_ref: string;
  type: TxType;
  amount: number;
  currency: string;
  idempotency_key: string;
  operator_tx_ref?: string;
  status: TxStatus;
  error_code?: string;
  /** Set on FREE_ROUND_BET / FREE_ROUND_WIN rows (operator promo reconciliation). */
  campaign_id?: string;
  /** W3C trace id of the request that made the move (filled from the current trace). */
  trace_id?: string;
}

export interface TxRecord extends TxInput {
  id: string;
  seq: number;
  created_at: string;
}

export interface TxFilter {
  operator_id?: string;
  round_ref?: string;
  type?: TxType;
  status?: TxStatus;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class InMemoryTransactionStore {
  private readonly entries: TxRecord[] = [];
  private readonly byKey = new Map<string, TxRecord>();

  constructor(private readonly persistence: Persistence = NullPersistence) {}

  hydrate(rows: TxRecord[]): void {
    for (const r of rows) {
      this.entries.push(r);
      this.byKey.set(r.idempotency_key, r);
    }
  }

  /** Append a transaction. Idempotent: a repeated idempotency_key returns the stored row. */
  private readonly listeners: Array<(tx: TxRecord) => void> = [];

  /** Called once per NEW transaction (not on an idempotent replay): logs, metrics. */
  onRecord(fn: (tx: TxRecord) => void): void {
    this.listeners.push(fn);
  }

  record(input: TxInput): TxRecord {
    const existing = this.byKey.get(input.idempotency_key);
    if (existing) return clone(existing);
    const traceId = input.trace_id ?? currentTrace()?.traceId;
    const record: TxRecord = {
      ...input,
      ...(traceId ? { trace_id: traceId } : {}),
      id: randomUUID(),
      seq: this.entries.length,
      created_at: new Date().toISOString()
    };
    this.entries.push(record);
    this.byKey.set(record.idempotency_key, record);
    this.persistence.save("wallet_transactions", record);
    for (const fn of this.listeners) {
      try { fn(clone(record)); } catch { /* an observer must never fail a money move */ }
    }
    return clone(record);
  }

  getByKey(key: string): TxRecord | null {
    const r = this.byKey.get(key);
    return r ? clone(r) : null;
  }

  list(filter: TxFilter = {}): TxRecord[] {
    return this.entries
      .filter((t) => (filter.operator_id ? t.operator_id === filter.operator_id : true))
      .filter((t) => (filter.round_ref ? t.round_ref === filter.round_ref : true))
      .filter((t) => (filter.type ? t.type === filter.type : true))
      .filter((t) => (filter.status ? t.status === filter.status : true))
      .map(clone);
  }

  /** Rounds whose win credit failed and was never later confirmed (the settlement queue). */
  listFailedSettlements(operatorId?: string): TxRecord[] {
    const confirmedCreditRounds = new Set(
      this.entries
        .filter((t) => WIN_TX_TYPES.has(t.type) && t.status === "confirmed")
        .map((t) => t.round_ref)
    );
    return this.entries
      .filter((t) => WIN_TX_TYPES.has(t.type) && t.status === "failed")
      .filter((t) => !confirmedCreditRounds.has(t.round_ref))
      .filter((t) => (operatorId ? t.operator_id === operatorId : true))
      .map(clone);
  }

  /**
   * Debits whose outcome is unknown (the casino may hold the stake) and whose
   * reversal the casino has not yet acknowledged: the debit-reconciliation queue.
   */
  listPendingReversals(operatorId?: string): TxRecord[] {
    const reversedRounds = new Set(this.entries.filter((t) => t.type === "ROLLBACK").map((t) => t.round_ref));
    return this.entries
      .filter((t) => BET_TX_TYPES.has(t.type) && t.status === "failed" && t.error_code === DEBIT_OUTCOME_UNKNOWN)
      .filter((t) => !reversedRounds.has(t.round_ref))
      .filter((t) => (operatorId ? t.operator_id === operatorId : true))
      .map(clone);
  }

  size(): number {
    return this.entries.length;
  }
}
