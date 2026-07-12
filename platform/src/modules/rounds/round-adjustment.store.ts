import { randomUUID } from "node:crypto";
import type { RoundStatus } from "../ledger/ledger.types";
import { NullPersistence, type Persistence } from "../../persistence/persistence";

/**
 * Append-only overlay recording admin-driven status changes to rounds. The round
 * ledger itself is immutable + hash-chained, so we never edit a RoundRecord; instead
 * a void/settle is a NEW adjustment row that references the round_ref, and the
 * "effective status" of a round is the latest adjustment's status (falling back to
 * the round's originally-recorded status). This preserves the tamper-evident chain.
 */
export type AdjustmentKind = "void" | "settle" | "recredit";

export interface AdjustmentInput {
  round_ref: string;
  operator_id: string;
  operator_player_id: string;
  kind: AdjustmentKind;
  /** Resulting effective round status after this adjustment. */
  effective_status: RoundStatus;
  reason: string;
  actor_id: string;
  /** Optional linkage to the compensating wallet transaction(s). */
  wallet_tx_refs?: string[];
}

export interface AdjustmentRecord extends AdjustmentInput {
  id: string;
  seq: number;
  created_at: string;
}

export interface AdjustmentFilter {
  operator_id?: string;
  round_ref?: string;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class InMemoryRoundAdjustmentStore {
  private readonly entries: AdjustmentRecord[] = [];

  constructor(private readonly persistence: Persistence = NullPersistence) {}

  hydrate(rows: AdjustmentRecord[]): void {
    for (const r of rows) this.entries.push(r);
  }

  append(input: AdjustmentInput): AdjustmentRecord {
    const record: AdjustmentRecord = {
      ...input,
      id: randomUUID(),
      seq: this.entries.length,
      created_at: new Date().toISOString()
    };
    this.entries.push(record);
    this.persistence.save("round_adjustments", record);
    return clone(record);
  }

  list(filter: AdjustmentFilter = {}): AdjustmentRecord[] {
    return this.entries
      .filter((a) => (filter.operator_id ? a.operator_id === filter.operator_id : true))
      .filter((a) => (filter.round_ref ? a.round_ref === filter.round_ref : true))
      .map(clone);
  }

  /** Latest adjustment for a round (its current effective status source), or null. */
  latest(roundRef: string): AdjustmentRecord | null {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i].round_ref === roundRef) return clone(this.entries[i]);
    }
    return null;
  }

  /** Effective status = latest adjustment status, else the caller-supplied recorded status. */
  effectiveStatus(roundRef: string, recorded: RoundStatus): RoundStatus {
    return this.latest(roundRef)?.effective_status ?? recorded;
  }

  /** Set of round_refs that have been voided (used to exclude them from reporting). */
  voidedRoundRefs(operatorId?: string): Set<string> {
    const voided = new Set<string>();
    for (const a of this.entries) {
      if (operatorId && a.operator_id !== operatorId) continue;
      if (a.effective_status === "void") voided.add(a.round_ref);
      else voided.delete(a.round_ref); // a later non-void adjustment un-voids
    }
    return voided;
  }

  size(): number {
    return this.entries.length;
  }
}
