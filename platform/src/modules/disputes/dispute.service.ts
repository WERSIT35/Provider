import { randomUUID } from "node:crypto";
import type { RoundLifecycleService } from "../rounds/round-lifecycle.service";
import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { AuditRepository } from "../ledger/ledger.types";
import { NullPersistence, type Persistence } from "../../persistence/persistence";

/**
 * Operator ↔ provider dispute queue.
 *
 * Casinos (operator admins) cannot move money themselves; when a player contests a
 * round — "the win didn't land", "this round shouldn't have counted" — the operator
 * RAISES a dispute here. A provider admin then APPROVES it (which executes the
 * corresponding lifecycle action: void or settle) or REJECTS it with a reason.
 * Append-only history; the current state is the latest row per dispute id.
 */
export type DisputeKind = "void" | "settle";
export type DisputeStatus = "open" | "approved" | "rejected";

export interface DisputeRecord {
  id: string;
  operator_id: string;
  round_ref: string;
  kind: DisputeKind;
  reason: string;
  status: DisputeStatus;
  requested_by: string;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface DisputeFilter {
  operator_id?: string;
  status?: DisputeStatus;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class DisputeService {
  private readonly disputes = new Map<string, DisputeRecord>();

  constructor(
    private readonly lifecycle: RoundLifecycleService,
    private readonly ledger: RoundLedgerService,
    private readonly audit: AuditRepository,
    private readonly persistence: Persistence = NullPersistence
  ) {}

  hydrate(rows: DisputeRecord[]): void {
    for (const d of rows) this.disputes.set(d.id, d);
  }

  private persist(d: DisputeRecord): void {
    this.persistence.save("disputes", d);
  }

  /** Operator raises a dispute against one of THEIR rounds. */
  raise(input: {
    operator_id: string;
    round_ref: string;
    kind: DisputeKind;
    reason: string;
    requested_by: string;
  }): DisputeRecord {
    const round = this.ledger.getRound(input.round_ref);
    if (!round) throw new Error("ROUND_NOT_FOUND");
    if (round.operator_id !== input.operator_id) throw new Error("ROUND_NOT_FOUND"); // don't leak cross-tenant
    if (!input.reason?.trim()) throw new Error("REASON_REQUIRED");

    const record: DisputeRecord = {
      id: `dsp_${randomUUID().slice(0, 12)}`,
      operator_id: input.operator_id,
      round_ref: input.round_ref,
      kind: input.kind,
      reason: input.reason.trim(),
      status: "open",
      requested_by: input.requested_by,
      resolved_by: null,
      resolution_note: null,
      created_at: new Date().toISOString(),
      resolved_at: null
    };
    this.disputes.set(record.id, record);
    this.persist(record);
    this.audit.append({
      operator_id: input.operator_id,
      actor_type: "operator",
      actor_id: input.requested_by,
      action: "dispute.raise",
      target_type: "round",
      target_id: input.round_ref
    });
    return clone(record);
  }

  get(id: string): DisputeRecord | null {
    const d = this.disputes.get(id);
    return d ? clone(d) : null;
  }

  list(filter: DisputeFilter = {}): DisputeRecord[] {
    return Array.from(this.disputes.values())
      .filter((d) => (filter.operator_id ? d.operator_id === filter.operator_id : true))
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(clone);
  }

  /** Provider approves → executes the requested lifecycle action. */
  async approve(id: string, providerAdminId: string, note = ""): Promise<DisputeRecord> {
    const d = this.disputes.get(id);
    if (!d) throw new Error("DISPUTE_NOT_FOUND");
    if (d.status !== "open") throw new Error("DISPUTE_ALREADY_RESOLVED");

    const reason = `dispute ${d.id}: ${d.reason}`;
    if (d.kind === "void") {
      await this.lifecycle.voidRound(d.round_ref, providerAdminId, reason);
    } else {
      await this.lifecycle.settleRound(d.round_ref, providerAdminId, reason);
    }

    d.status = "approved";
    d.resolved_by = providerAdminId;
    d.resolution_note = note || null;
    d.resolved_at = new Date().toISOString();
    this.persist(d);
    this.audit.append({
      operator_id: d.operator_id,
      actor_type: "admin",
      actor_id: providerAdminId,
      action: "dispute.approve",
      target_type: "dispute",
      target_id: d.id
    });
    return clone(d);
  }

  /** Provider rejects → no money moves, dispute closed with a reason. */
  reject(id: string, providerAdminId: string, note: string): DisputeRecord {
    const d = this.disputes.get(id);
    if (!d) throw new Error("DISPUTE_NOT_FOUND");
    if (d.status !== "open") throw new Error("DISPUTE_ALREADY_RESOLVED");
    if (!note?.trim()) throw new Error("REJECTION_NOTE_REQUIRED");

    d.status = "rejected";
    d.resolved_by = providerAdminId;
    d.resolution_note = note.trim();
    d.resolved_at = new Date().toISOString();
    this.persist(d);
    this.audit.append({
      operator_id: d.operator_id,
      actor_type: "admin",
      actor_id: providerAdminId,
      action: "dispute.reject",
      target_type: "dispute",
      target_id: d.id
    });
    return clone(d);
  }
}
