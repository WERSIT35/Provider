import { randomUUID } from "node:crypto";
import { GENESIS_HASH, hashPayload, chainHash } from "./hash-chain";
import { currentTrace } from "../../lib/trace-context";
import { NullPersistence, type Persistence } from "../../persistence/persistence";
import type { LedgerSignature, SignatureStatus, SignatureSummary } from "../../lib/security/signing-keyring";
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

// Not part of a row's hashed content: the chain links, and the signature made over them.
const CHAIN_FIELDS = new Set(["id", "prev_hash", "payload_hash", "chain_hash", "signature", "signing_key_id"]);

/** Signs each new ledger row (the platform keyring, signing-keyring.ts). */
export interface LedgerSigner {
  signLedger(table: "rounds" | "audit_records", seq: number, chainHash: string): LedgerSignature;
}

function contentOf<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!CHAIN_FIELDS.has(key)) out[key] = record[key];
  }
  return out;
}

/**
 * The content to hash for a new entry: the input plus the current request's trace id
 * (src/lib/trace-context.ts), unless the caller passed one. The key is added ONLY when
 * there is a trace: the payload hash covers every key (even an undefined one hashes as
 * null), so an entry without a trace must hash exactly as entries did before 0011, and
 * Postgres's NULL is dropped again on hydrate (persistence.ts TABLES omitNull).
 */
function withTrace<T extends { trace_id?: string }>(input: T): T {
  const { trace_id, ...rest } = input;
  const traceId = trace_id ?? currentTrace()?.traceId;
  return (traceId ? { ...rest, trace_id: traceId } : rest) as T;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryRoundRepository implements RoundRepository {
  private readonly entries: RoundRecord[] = [];
  private readonly byRef = new Map<string, RoundRecord>();

  constructor(
    private readonly persistence: Persistence = NullPersistence,
    private readonly signer?: LedgerSigner
  ) {}

  /** Rebuild state from Postgres on boot (rows already carry their chain fields). */
  hydrate(rows: RoundRecord[]): void {
    for (const r of rows) {
      this.entries.push(r);
      this.byRef.set(r.round_ref, r);
    }
  }

  append(input: RoundInput): RoundRecord {
    if (this.byRef.has(input.round_ref)) {
      throw new Error(`DUPLICATE_ROUND_REF:${input.round_ref}`);
    }
    const seq = this.entries.length;
    const prev_hash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1].chain_hash;
    const created_at = new Date().toISOString();
    const content = { ...withTrace(input), seq, created_at };
    const payload_hash = hashPayload(content);
    const chain_hash = chainHash(prev_hash, payload_hash);
    const record: RoundRecord = {
      ...content,
      id: randomUUID(),
      prev_hash,
      payload_hash,
      chain_hash,
      ...(this.signer ? this.signer.signLedger("rounds", seq, chain_hash) : {})
    };
    this.entries.push(record);
    this.byRef.set(record.round_ref, record);
    this.persistence.save("rounds", record);
    return clone(record);
  }

  getByRef(roundRef: string): RoundRecord | null {
    const found = this.byRef.get(roundRef);
    return found ? clone(found) : null;
  }

  list(filter: RoundFilter = {}): RoundRecord[] {
    return this.entries
      .filter((r) => (filter.operator_id ? r.operator_id === filter.operator_id : true))
      .filter((r) => (filter.operator_player_id ? r.operator_player_id === filter.operator_player_id : true))
      .filter((r) => (filter.session_id ? r.session_id === filter.session_id : true))
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .map(clone);
  }

  verifyChain(): ChainVerification {
    return verifyChainGeneric(this.entries);
  }

  /** Check every row's signature (see summarizeSignatures). */
  verifySignatures(check: (row: RoundRecord) => SignatureStatus): SignatureSummary {
    return summarizeSignatures(this.entries, check);
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

  constructor(
    private readonly persistence: Persistence = NullPersistence,
    private readonly signer?: LedgerSigner
  ) {}

  hydrate(rows: AuditRecord[]): void {
    for (const r of rows) this.entries.push(r);
  }

  append(input: AuditInput): AuditRecord {
    const seq = this.entries.length;
    const prev_hash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1].chain_hash;
    const created_at = new Date().toISOString();
    const content = { ...withTrace(input), seq, created_at };
    const payload_hash = hashPayload(content);
    const chain_hash = chainHash(prev_hash, payload_hash);
    const record: AuditRecord = {
      ...content,
      id: randomUUID(),
      prev_hash,
      payload_hash,
      chain_hash,
      ...(this.signer ? this.signer.signLedger("audit_records", seq, chain_hash) : {})
    };
    this.entries.push(record);
    this.persistence.save("audit_records", record);
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

  /** Check every row's signature (see summarizeSignatures). */
  verifySignatures(check: (row: AuditRecord) => SignatureStatus): SignatureSummary {
    return summarizeSignatures(this.entries, check);
  }

  /** TEST-ONLY: corrupt a stored record to prove tamper detection. Never call in prod. */
  __unsafeTamper(seq: number, patch: Partial<AuditRecord>): void {
    Object.assign(this.entries[seq], patch);
  }

  size(): number {
    return this.entries.length;
  }
}

/**
 * Tally of per-row signature checks. ok = no row is invalid or signed by a key the
 * platform does not know. Unsigned rows (recorded before migration 0012) are counted,
 * not failed: the hash chain still covers them.
 */
function summarizeSignatures<T extends { seq: number }>(entries: ReadonlyArray<T>, check: (row: T) => SignatureStatus): SignatureSummary {
  const out: SignatureSummary = { ok: true, checked: entries.length, valid: 0, unsigned: 0, invalid: 0, unknown_key: 0, first_bad_seq: null };
  for (const row of entries) {
    const status = check(row);
    out[status] += 1;
    if ((status === "invalid" || status === "unknown_key") && out.first_bad_seq === null) {
      out.first_bad_seq = row.seq;
      out.ok = false;
    }
  }
  return out;
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
