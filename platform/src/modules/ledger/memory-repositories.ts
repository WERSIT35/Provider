import { randomUUID } from "node:crypto";
import { GENESIS_HASH, hashPayload, chainHash } from "./hash-chain";
import type {
  RoundRepository,
  RoundInput,
  RoundRecord,
  RoundFilter,
  AuditRepository,
  AuditInput,
  AuditRecord,
  ChainVerification
} from "./ledger.types";

/**
 * In-memory, append-only, hash-chained implementations. These encode the ledger's
 * immutability + integrity SEMANTICS independent of storage; a Postgres-backed
 * implementation of the same interfaces (with WORM table grants per
 * migrations/0001_core.sql) is the production swap-in. Used directly in tests/dev.
 */

const CHAIN_FIELDS = new Set(["id", "prev_hash", "payload_hash", "chain_hash"]);

function contentOf<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!CHAIN_FIELDS.has(key)) out[key] = record[key];
  }
  return out;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryRoundRepository implements RoundRepository {
  private readonly entries: RoundRecord[] = [];
  private readonly byRef = new Map<string, RoundRecord>();

  append(input: RoundInput): RoundRecord {
    if (this.byRef.has(input.round_ref)) {
      throw new Error(`DUPLICATE_ROUND_REF:${input.round_ref}`);
    }
    const seq = this.entries.length;
    const prev_hash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1].chain_hash;
    const created_at = new Date().toISOString();
    const content = { ...input, seq, created_at };
    const payload_hash = hashPayload(content);
    const record: RoundRecord = {
      ...content,
      id: randomUUID(),
      prev_hash,
      payload_hash,
      chain_hash: chainHash(prev_hash, payload_hash)
    };
    this.entries.push(record);
    this.byRef.set(record.round_ref, record);
    return clone(record);
  }

  getByRef(roundRef: string): RoundRecord | null {
    const found = this.byRef.get(roundRef);
    return found ? clone(found) : null;
  }

  list(filter: RoundFilter = {}): RoundRecord[] {
    return this.entries
      .filter((r) => (filter.operator_id ? r.operator_id === filter.operator_id : true))
      .filter((r) => (filter.session_id ? r.session_id === filter.session_id : true))
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .map(clone);
  }

  verifyChain(): ChainVerification {
    return verifyChainGeneric(this.entries);
  }

  size(): number {
    return this.entries.length;
  }

  /** TEST-ONLY: corrupt a stored record to prove tamper detection. Never call in prod. */
  __unsafeTamper(seq: number, patch: Partial<RoundRecord>): void {
    Object.assign(this.entries[seq], patch);
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditRecord[] = [];

  append(input: AuditInput): AuditRecord {
    const seq = this.entries.length;
    const prev_hash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1].chain_hash;
    const created_at = new Date().toISOString();
    const content = { ...input, seq, created_at };
    const payload_hash = hashPayload(content);
    const record: AuditRecord = {
      ...content,
      id: randomUUID(),
      prev_hash,
      payload_hash,
      chain_hash: chainHash(prev_hash, payload_hash)
    };
    this.entries.push(record);
    return clone(record);
  }

  list(filter: { operator_id?: string | null; action?: string } = {}): AuditRecord[] {
    return this.entries
      .filter((r) =>
        filter.operator_id !== undefined ? r.operator_id === filter.operator_id : true
      )
      .filter((r) => (filter.action ? r.action === filter.action : true))
      .map(clone);
  }

  verifyChain(): ChainVerification {
    return verifyChainGeneric(this.entries);
  }

  size(): number {
    return this.entries.length;
  }
}

interface ChainEntry {
  seq: number;
  prev_hash: string;
  payload_hash: string;
  chain_hash: string;
}

function verifyChainGeneric(entries: ReadonlyArray<ChainEntry>): ChainVerification {
  let prev = GENESIS_HASH;
  for (const entry of entries) {
    const recomputedPayload = hashPayload(contentOf(entry as unknown as Record<string, unknown>));
    if (recomputedPayload !== entry.payload_hash) {
      return { ok: false, length: entries.length, brokenAtSeq: entry.seq, reason: "payload_hash_mismatch" };
    }
    if (entry.prev_hash !== prev) {
      return { ok: false, length: entries.length, brokenAtSeq: entry.seq, reason: "prev_hash_mismatch" };
    }
    if (chainHash(prev, recomputedPayload) !== entry.chain_hash) {
      return { ok: false, length: entries.length, brokenAtSeq: entry.seq, reason: "chain_hash_mismatch" };
    }
    prev = entry.chain_hash;
  }
  return { ok: true, length: entries.length };
}
