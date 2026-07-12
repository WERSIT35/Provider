import { randomUUID } from "node:crypto";
import { NullPersistence, type Persistence } from "../../persistence/persistence";

/** Money-movement ledger (plan §3.3 wallet_transactions). Append-only + idempotent
 * by idempotency_key. Feeds reporting, reconciliation, and the failed-settlement queue. */

export type TxType = "DEBIT" | "CREDIT" | "ROLLBACK" | "ADJUSTMENT";
export type TxStatus = "confirmed" | "failed" | "rolled_back";

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
  record(input: TxInput): TxRecord {
    const existing = this.byKey.get(input.idempotency_key);
    if (existing) return clone(existing);
    const record: TxRecord = {
      ...input,
      id: randomUUID(),
      seq: this.entries.length,
      created_at: new Date().toISOString()
    };
    this.entries.push(record);
    this.byKey.set(record.idempotency_key, record);
    this.persistence.save("wallet_transactions", record);
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
        .filter((t) => t.type === "CREDIT" && t.status === "confirmed")
        .map((t) => t.round_ref)
    );
    return this.entries
      .filter((t) => t.type === "CREDIT" && t.status === "failed")
      .filter((t) => !confirmedCreditRounds.has(t.round_ref))
      .filter((t) => (operatorId ? t.operator_id === operatorId : true))
      .map(clone);
  }

  size(): number {
    return this.entries.length;
  }
}
