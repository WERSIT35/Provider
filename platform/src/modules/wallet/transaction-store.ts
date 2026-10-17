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

/** TxRecord is flat (primitives only): a shallow copy is a full copy, without a JSON round trip per read. */
function clone<T>(v: T): T {
  return { ...(v as object) } as T;
}

export class InMemoryTransactionStore {
  private readonly entries: TxRecord[] = [];
  private readonly byKey = new Map<string, TxRecord>();
  /** Older rows pulled from Postgres for a request (bounded; see addCold). */
  private readonly cold = new Map<string, TxRecord>();
  private readonly retain: number | null;
  private readonly coldCapacity: number;
  private nextSeq = 0;
  /**
   * The two operational queues, kept as rows are recorded so they never need a scan of
   * the whole ledger: unknown debits not yet reversed (by round), and failed win
   * credits whose round has no confirmed credit yet (by round).
   */
  private readonly pendingReversals = new Map<string, TxRecord[]>();
  private readonly failedWins = new Map<string, TxRecord[]>();

  /**
   * `retain` (Postgres mode): keep only the newest `retain` rows hot. Without it every
   * row is kept, exactly as before (in-memory mode).
   */
  constructor(
    private readonly persistence: Persistence = NullPersistence,
    window: { retain?: number; cold?: number } = {}
  ) {
    this.retain = window.retain ?? null;
    this.coldCapacity = window.cold ?? 15_000;
  }

  /** Boot: rows oldest first. In windowed mode `nextSeq` continues the ledger past rows not loaded. */
  hydrate(rows: TxRecord[], nextSeq?: number): void {
    for (const r of rows) {
      this.entries.push(r);
      this.byKey.set(r.idempotency_key, r);
      this.track(r);
    }
    const last = rows[rows.length - 1];
    this.nextSeq = Math.max(this.nextSeq, nextSeq ?? (last ? last.seq + 1 : 0));
  }

  /** Boot (windowed): queue rows older than the window (pending reversals, failed credits). */
  hydrateQueues(rows: TxRecord[]): void {
    for (const r of rows.sort((a, b) => a.seq - b.seq)) {
      if (!this.byKey.has(r.idempotency_key)) this.cold.set(r.idempotency_key, r);
      this.track(r);
    }
  }

  /** Older rows pulled from Postgres for a request (an inspector open, a void, an export). */
  addCold(rows: TxRecord[]): void {
    for (const r of rows) {
      if (this.byKey.has(r.idempotency_key)) continue;
      this.cold.delete(r.idempotency_key);
      this.cold.set(r.idempotency_key, r);
    }
    while (this.cold.size > this.coldCapacity) this.cold.delete(this.cold.keys().next().value as string);
  }

  /** Keep the queues current with one new (or hydrated) row. */
  private track(r: TxRecord): void {
    if (BET_TX_TYPES.has(r.type) && r.status === "failed" && r.error_code === DEBIT_OUTCOME_UNKNOWN) {
      // Every unknown debit of the round (a round normally has one; the full-scan
      // definition this replaces listed them all).
      if (!this.reversedRounds.has(r.round_ref)) addOnce(this.pendingReversals, r);
    } else if (r.type === "ROLLBACK") {
      this.reversedRounds.add(r.round_ref);
      this.pendingReversals.delete(r.round_ref);
    } else if (WIN_TX_TYPES.has(r.type) && r.status === "failed") {
      if (!this.creditedRounds.has(r.round_ref)) addOnce(this.failedWins, r);
    } else if (WIN_TX_TYPES.has(r.type) && r.status === "confirmed") {
      this.creditedRounds.add(r.round_ref);
      this.failedWins.delete(r.round_ref);
    }
  }
  /**
   * Rounds already reversed / credited, so a LATER failure row for the same round does
   * not re-enter a queue. Bounded in practice by the queues themselves in windowed mode
   * (only rounds that ever had an unknown debit or a failed credit are recorded).
   */
  private readonly reversedRounds = new BoundedSet(50_000);
  private readonly creditedRounds = new BoundedSet(50_000);

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
      seq: this.nextSeq++,
      created_at: new Date().toISOString()
    };
    this.entries.push(record);
    this.byKey.set(record.idempotency_key, record);
    this.track(record);
    this.persistence.save("wallet_transactions", record);
    if (this.retain !== null && this.entries.length > this.retain * 1.25) {
      for (const gone of this.entries.splice(0, this.entries.length - this.retain)) this.byKey.delete(gone.idempotency_key);
    }
    for (const fn of this.listeners) {
      try { fn(clone(record)); } catch { /* an observer must never fail a money move */ }
    }
    return clone(record);
  }

  getByKey(key: string): TxRecord | null {
    const r = this.byKey.get(key) ?? this.cold.get(key);
    return r ? clone(r) : null;
  }

  /** Rows held in memory (hot + cold), oldest first. */
  private held(): TxRecord[] {
    if (this.cold.size === 0) return this.entries;
    return [...this.cold.values(), ...this.entries].sort((a, b) => a.seq - b.seq);
  }

  list(filter: TxFilter = {}): TxRecord[] {
    return this.held()
      .filter((t) => (filter.operator_id ? t.operator_id === filter.operator_id : true))
      .filter((t) => (filter.round_ref ? t.round_ref === filter.round_ref : true))
      .filter((t) => (filter.type ? t.type === filter.type : true))
      .filter((t) => (filter.status ? t.status === filter.status : true))
      .map(clone);
  }

  /** Rounds whose win credit failed and was never later confirmed (the settlement queue). */
  listFailedSettlements(operatorId?: string): TxRecord[] {
    return [...this.failedWins.values()]
      .flat()
      .filter((t) => (operatorId ? t.operator_id === operatorId : true))
      .sort((a, b) => a.seq - b.seq)
      .map(clone);
  }

  /**
   * Debits whose outcome is unknown (the casino may hold the stake) and whose
   * reversal the casino has not yet acknowledged: the debit-reconciliation queue.
   */
  listPendingReversals(operatorId?: string): TxRecord[] {
    return [...this.pendingReversals.values()]
      .flat()
      .filter((t) => (operatorId ? t.operator_id === operatorId : true))
      .sort((a, b) => a.seq - b.seq)
      .map(clone);
  }

  /** Total rows in the ledger (not just the ones held in memory). */
  size(): number {
    return this.nextSeq;
  }

  /** Rows held in memory (hot + cold). */
  heldCount(): number {
    return this.entries.length + this.cold.size;
  }
}

/** Queue a row under its round, once (boot may present a row both in the window and as a queue row). */
function addOnce(queue: Map<string, TxRecord[]>, r: TxRecord): void {
  const rows = queue.get(r.round_ref) ?? [];
  if (rows.some((x) => x.idempotency_key === r.idempotency_key)) return;
  queue.set(r.round_ref, [...rows, r]);
}

/** A Set that forgets its oldest members past `capacity`. */
class BoundedSet {
  private readonly set = new Set<string>();
  constructor(private readonly capacity: number) {}
  has(v: string): boolean {
    return this.set.has(v);
  }
  add(v: string): void {
    this.set.delete(v);
    this.set.add(v);
    if (this.set.size > this.capacity) this.set.delete(this.set.values().next().value as string);
  }
}
