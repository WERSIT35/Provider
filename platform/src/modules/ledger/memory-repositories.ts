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
 *
 * Bounded memory (Phase 2): with Postgres as the system of record, a repository is
 * built with `retain` and keeps only a HOT window of its newest rows plus the chain tip
 * (next seq + last chain hash), so appends never need old rows. Older rows a request
 * needs are pulled into a bounded COLD cache (addCold, by modules/history). Without
 * `retain` (in-memory mode: tests, local dev) every row is kept, exactly as before.
 */

/** Window options: keep the newest `retain` rows hot and up to `cold` older rows cached. */
export interface WindowOptions {
  retain?: number;
  cold?: number;
}

/** Insertion-ordered LRU of older rows pulled from Postgres. */
class ColdCache<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly capacity: number) {}
  get(key: string): T | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as string);
  }
  values(): IterableIterator<T> {
    return this.map.values();
  }
  get size(): number {
    return this.map.size;
  }
}

/** The append position of a hash-chained ledger: next seq and the last chain hash. */
export interface ChainTip {
  nextSeq: number;
  lastHash: string;
}

// Not part of a row's hashed content: the chain links, and the signature made over them.
const CHAIN_FIELDS = new Set(["id", "prev_hash", "payload_hash", "chain_hash", "signature", "signing_key_id"]);

/** Signs each new ledger row (the platform keyring, signing-keyring.ts). */
export interface LedgerSigner {
  signLedger(table: "rounds" | "audit_records", seq: number, chainHash: string): LedgerSignature;
}

export function contentOf<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
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

/** Running per-session totals (reality check), kept as rounds are appended. */
export interface SessionStatsAcc {
  rounds: number;
  wagered: number;
  won: number;
}

export class InMemoryRoundRepository implements RoundRepository {
  private readonly entries: RoundRecord[] = [];
  private readonly byRef = new Map<string, RoundRecord>();
  private readonly cold: ColdCache<RoundRecord>;
  private readonly retain: number | null;
  private tip: ChainTip = { nextSeq: 0, lastHash: GENESIS_HASH };
  private readonly stats = new Map<string, SessionStatsAcc>();

  constructor(
    private readonly persistence: Persistence = NullPersistence,
    private readonly signer?: LedgerSigner,
    window: WindowOptions = {}
  ) {
    this.retain = window.retain ?? null;
    this.cold = new ColdCache(window.cold ?? 5_000);
  }

  /** True when only a window of history is held (Postgres is the system of record). */
  get windowed(): boolean {
    return this.retain !== null;
  }

  /**
   * Rebuild state on boot (rows already carry their chain fields, oldest first). In
   * windowed mode `rows` is only the newest window and `tip` is where the chain ends.
   */
  hydrate(rows: RoundRecord[], tip?: ChainTip): void {
    for (const r of rows) {
      this.entries.push(r);
      this.byRef.set(r.round_ref, r);
      this.count(r);
    }
    const last = rows[rows.length - 1];
    this.tip = tip ?? (last ? { nextSeq: last.seq + 1, lastHash: last.chain_hash } : this.tip);
  }

  /** Seed the reality-check totals of sessions whose early rounds are not in the window. */
  seedSessionStats(rows: Array<{ session_id: string } & SessionStatsAcc>): void {
    for (const r of rows) this.stats.set(r.session_id, { rounds: r.rounds, wagered: r.wagered, won: r.won });
  }

  /** Rounds, money wagered and money won in one session so far. */
  sessionStats(sessionId: string): SessionStatsAcc {
    const s = this.stats.get(sessionId);
    return s ? { ...s } : { rounds: 0, wagered: 0, won: 0 };
  }

  /** Forget an evicted session's running totals. */
  dropSessionStats(sessionId: string): void {
    this.stats.delete(sessionId);
  }

  private count(r: RoundRecord): void {
    const s = this.stats.get(r.session_id) ?? { rounds: 0, wagered: 0, won: 0 };
    s.rounds += 1;
    s.wagered += r.bet_charged;
    s.won += r.total_win;
    this.stats.set(r.session_id, s);
  }

  /** Older rows pulled from Postgres for a request (bounded LRU; never appended to). */
  addCold(rows: RoundRecord[]): void {
    for (const r of rows) if (!this.byRef.has(r.round_ref)) this.cold.set(r.round_ref, r);
  }

  append(input: RoundInput): RoundRecord {
    if (this.byRef.has(input.round_ref) || this.cold.get(input.round_ref)) {
      throw new Error(`DUPLICATE_ROUND_REF:${input.round_ref}`);
    }
    const seq = this.tip.nextSeq;
    const prev_hash = this.tip.lastHash;
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
    this.tip = { nextSeq: seq + 1, lastHash: chain_hash };
    this.count(record);
    this.persistence.save("rounds", record);
    this.trim();
    return clone(record);
  }

  /** Windowed: drop the oldest hot rows in batches once the window is 25% over. */
  private trim(): void {
    if (this.retain === null || this.entries.length <= this.retain * 1.25) return;
    const gone = this.entries.splice(0, this.entries.length - this.retain);
    for (const r of gone) this.byRef.delete(r.round_ref);
  }

  getByRef(roundRef: string): RoundRecord | null {
    const found = this.byRef.get(roundRef) ?? this.cold.get(roundRef);
    return found ? clone(found) : null;
  }

  /** Rounds held in memory (hot window + cold cache), oldest first. */
  private held(): RoundRecord[] {
    if (this.cold.size === 0) return this.entries;
    return [...this.cold.values(), ...this.entries].sort((a, b) => a.seq - b.seq);
  }

  list(filter: RoundFilter = {}): RoundRecord[] {
    return this.held()
      .filter((r) => (filter.operator_id ? r.operator_id === filter.operator_id : true))
      .filter((r) => (filter.operator_player_id ? r.operator_player_id === filter.operator_player_id : true))
      .filter((r) => (filter.session_id ? r.session_id === filter.session_id : true))
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .map(clone);
  }

  /** Whole chain in memory mode; in windowed mode the hot window's own links (the full sweep is modules/history). */
  verifyChain(): ChainVerification {
    // Memory mode holds the whole chain, so it must start at genesis (a tampered first
    // row's prev_hash must not vouch for itself); a window starts at its oldest row.
    return verifyChainGeneric(this.entries, this.retain === null ? GENESIS_HASH : (this.entries[0]?.prev_hash ?? GENESIS_HASH));
  }

  /** Check every held row's signature (see summarizeSignatures). */
  verifySignatures(check: (row: RoundRecord) => SignatureStatus): SignatureSummary {
    return summarizeSignatures(this.entries, check);
  }

  /** Total rows in the ledger (not just the ones held in memory). */
  size(): number {
    return this.tip.nextSeq;
  }

  /** Rows held in memory (hot + cold): what bounded memory bounds. */
  heldCount(): number {
    return this.entries.length + this.cold.size;
  }

  /** TEST-ONLY: corrupt a stored record to prove tamper detection. Never call in prod. */
  __unsafeTamper(seq: number, patch: Partial<RoundRecord>): void {
    Object.assign(this.entries.find((r) => r.seq === seq)!, patch);
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditRecord[] = [];
  private readonly retain: number | null;
  private tip: ChainTip = { nextSeq: 0, lastHash: GENESIS_HASH };

  constructor(
    private readonly persistence: Persistence = NullPersistence,
    private readonly signer?: LedgerSigner,
    window: WindowOptions = {}
  ) {
    this.retain = window.retain ?? null;
  }

  hydrate(rows: AuditRecord[], tip?: ChainTip): void {
    for (const r of rows) this.entries.push(r);
    const last = rows[rows.length - 1];
    this.tip = tip ?? (last ? { nextSeq: last.seq + 1, lastHash: last.chain_hash } : this.tip);
  }

  append(input: AuditInput): AuditRecord {
    const seq = this.tip.nextSeq;
    const prev_hash = this.tip.lastHash;
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
    this.tip = { nextSeq: seq + 1, lastHash: chain_hash };
    this.persistence.save("audit_records", record);
    if (this.retain !== null && this.entries.length > this.retain * 1.25) this.entries.splice(0, this.entries.length - this.retain);
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
    // Memory mode holds the whole chain, so it must start at genesis (a tampered first
    // row's prev_hash must not vouch for itself); a window starts at its oldest row.
    return verifyChainGeneric(this.entries, this.retain === null ? GENESIS_HASH : (this.entries[0]?.prev_hash ?? GENESIS_HASH));
  }

  /** Check every held row's signature (see summarizeSignatures). */
  verifySignatures(check: (row: AuditRecord) => SignatureStatus): SignatureSummary {
    return summarizeSignatures(this.entries, check);
  }

  /** TEST-ONLY: corrupt a stored record to prove tamper detection. Never call in prod. */
  __unsafeTamper(seq: number, patch: Partial<AuditRecord>): void {
    Object.assign(this.entries.find((r) => r.seq === seq)!, patch);
  }

  /** Total rows in the ledger (not just the ones held in memory). */
  size(): number {
    return this.tip.nextSeq;
  }

  heldCount(): number {
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

/** Verify a contiguous run of chain rows; `start` = the prev_hash the first row must carry. */
export function verifyChainGeneric(entries: ReadonlyArray<ChainEntry>, start: string = GENESIS_HASH): ChainVerification {
  let prev = start;
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
