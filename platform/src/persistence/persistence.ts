import type { Pool } from "pg";
import { currentTrace } from "../lib/trace-context";
import { metrics } from "../lib/metrics";

/**
 * Write-through persistence port. The in-memory stores stay the read source of
 * truth; when a Persistence is present they ENQUEUE an upsert on every mutation,
 * and the request boundary (an app onSend hook) calls flush() to drain the queue
 * into Postgres in one transaction. On boot the stores hydrate() from loadTable().
 *
 * `save()` is synchronous (callable from the existing sync store methods); the
 * actual DB write is deferred to flush(). A no-op NullPersistence lets stores stay
 * unconditional.
 *
 * Durability contract (PostgresPersistence.flush):
 *  - ONE drain runs at a time. Concurrent requests group-commit: every caller that
 *    arrives while a drain runs shares the NEXT drain, which takes every queued row in
 *    one transaction (multi-row upserts per table). The platform never holds two write
 *    transactions at once and cannot deadlock with itself.
 *  - flush() resolves only when every row the CALLER queued (rows are tagged with the
 *    request's trace context) is committed. It rejects if any of them failed: a
 *    transient error (connection, deadlock, serialization) re-queues the rows for the
 *    next flush; a permanent one (constraint/trigger) QUARANTINES the offending rows,
 *    commits the rest of the batch, and is reported to the owner. A rejected row can
 *    never again block every later write.
 */
export interface Persistence {
  /** Enqueue an upsert of `row` into `table` (flushed at the request boundary). */
  save(table: string, row: object): void;
  /** Commit everything the caller queued; rejects if any of it was not committed. */
  flush(): Promise<void>;
  loadTable(table: string): Promise<Record<string, unknown>[]>;
}

/** Thrown by flush() when rows the caller queued were not committed. */
export class PersistenceError extends Error {
  constructor(
    message: string,
    /** transient = retried on the next flush; permanent = quarantined, never written. */
    readonly kind: "transient" | "permanent",
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "PersistenceError";
  }
}

/** A row Postgres refused permanently; kept for operators (GET /admin/v1/integrity). */
export interface QuarantinedRow {
  table: string;
  row: Record<string, unknown>;
  error: string;
  code: string | null;
  at: string;
}

/** Default when Postgres is disabled — pure in-memory, nothing is persisted. */
export const NullPersistence: Persistence = {
  save() {
    /* no-op */
  },
  async flush() {
    /* no-op */
  },
  async loadTable() {
    return [];
  }
};

interface TableSpec {
  columns: string[];
  pk: string[];
  jsonb: Set<string>;
  appendOnly: boolean;
  /** column → object-field renames (e.g. rounds.outcome_jsonb ⇄ record.outcome). */
  rename: Record<string, string>;
  /** column used to order rows on load (seq for the ledgers, else created_at). */
  orderBy?: string;
  /**
   * Monotonic version column: an upsert only overwrites a stored row whose version is
   * LOWER, so a stale or re-queued flush can never roll a row back (e.g. resurrect a
   * consumed free round). The store bumps it on every mutation.
   */
  version?: string;
  /**
   * Nullable columns added AFTER rows already existed in a hash-chained table. On load
   * a NULL is left off the object entirely (not set to null), because the payload
   * hash covers every key: a pre-existing cash round must rehydrate with exactly the
   * keys it was hashed with, or the whole chain would read as tampered.
   */
  omitNull: Set<string>;
  /** Columns an upsert may change on conflict (default: every non-key column). */
  updateColumns?: string[];
}

function spec(
  columns: string[],
  pk: string[],
  opts: { jsonb?: string[]; appendOnly?: boolean; rename?: Record<string, string>; orderBy?: string; version?: string; omitNull?: string[]; updateColumns?: string[] } = {}
): TableSpec {
  return {
    columns,
    pk,
    jsonb: new Set(opts.jsonb ?? []),
    appendOnly: Boolean(opts.appendOnly),
    rename: opts.rename ?? {},
    orderBy: opts.orderBy,
    version: opts.version,
    omitNull: new Set(opts.omitNull ?? []),
    updateColumns: opts.updateColumns
  };
}

/** The single source of table shapes shared by save() and loadTable(). */
const TABLES: Record<string, TableSpec> = {
  // regulatory: jsonb, omitted when unset (migration 0009; NULL = DEFAULT profile).
  operators: spec(["id", "name", "slug", "status", "default_currency", "regulatory", "created_at"], ["id"], { orderBy: "created_at", jsonb: ["regulatory"], omitNull: ["regulatory"] }),
  operator_domains: spec(["id", "operator_id", "domain", "environment", "status", "created_at"], ["id"], { orderBy: "created_at" }),
  operator_api_credentials: spec(
    ["id", "operator_id", "api_key_id", "secret_hash", "secret_last4", "hmac_secret", "environment", "status", "ip_allowlist", "created_at", "expires_at"],
    ["id"],
    { jsonb: ["ip_allowlist"], orderBy: "created_at" }
  ),
  games: spec(["id", "code", "title", "status", "created_at"], ["id"], { orderBy: "created_at" }),
  math_configs: spec(
    ["id", "game_id", "version", "rtp_profile_key", "theoretical_rtp", "config_hash", "status", "approved_by", "approved_at", "created_at"],
    ["id"],
    { orderBy: "created_at" }
  ),
  operator_games: spec(
    [
      "id", "operator_id", "game_id", "math_config_id", "currency", "jurisdiction", "allowed_bets", "status",
      "display_name", "thumbnail_url", "sort_order", "lobby_enabled", "created_at"
    ],
    ["id"],
    { jsonb: ["allowed_bets"], orderBy: "created_at" }
  ),
  operator_webhooks: spec(
    ["operator_id", "url", "secret", "secret_last4", "updated_at"],
    ["operator_id"],
    { orderBy: "updated_at" }
  ),
  player_sessions: spec(
    ["id", "operator_id", "game_id", "game_code", "math_config_id", "operator_player_id", "currency", "allowed_bets", "status", "free_spins_left", "free_spin_multiplier_carry", "bonus_round_win", "locked_bet", "locked_currency", "locked_ante", "locked_campaign_id", "locked_grant_id", "locked_feature_ref", "created_at"],
    ["id"],
    { jsonb: ["allowed_bets"], orderBy: "created_at" }
  ),
  rounds: spec(
    ["id", "seq", "round_ref", "session_id", "operator_id", "operator_player_id", "game_id", "math_config_id", "bet_amount", "bet_charged", "is_free_spin", "ante_enabled", "rng_seed_hex", "rng_algo", "rng_bytes_drawn", "outcome_hash", "total_win", "multiplier_applied", "status", "pre_state", "outcome_jsonb", "campaign_id", "grant_id", "engine_version", "rules_hash", "trace_id", "prev_hash", "payload_hash", "chain_hash", "signature", "signing_key_id", "created_at"],
    ["id"],
    { jsonb: ["pre_state", "outcome_jsonb"], appendOnly: true, rename: { outcome_jsonb: "outcome" }, orderBy: "seq", omitNull: ["campaign_id", "grant_id", "engine_version", "rules_hash", "trace_id", "signature", "signing_key_id"] }
  ),
  wallet_transactions: spec(
    ["id", "seq", "operator_id", "session_id", "round_ref", "type", "amount", "currency", "idempotency_key", "operator_tx_ref", "status", "error_code", "campaign_id", "trace_id", "created_at"],
    ["id"],
    { appendOnly: true, orderBy: "seq", omitNull: ["campaign_id", "trace_id"] }
  ),
  round_adjustments: spec(
    ["id", "seq", "round_ref", "operator_id", "operator_player_id", "kind", "effective_status", "reason", "actor_id", "wallet_tx_refs", "created_at"],
    ["id"],
    { jsonb: ["wallet_tx_refs"], appendOnly: true, orderBy: "seq" }
  ),
  audit_records: spec(
    ["id", "seq", "operator_id", "actor_type", "actor_id", "action", "target_type", "target_id", "trace_id", "payload_hash", "prev_hash", "chain_hash", "signature", "signing_key_id", "created_at"],
    ["id"],
    { appendOnly: true, orderBy: "seq", omitNull: ["trace_id", "signature", "signing_key_id"] }
  ),
  // Public halves of every key that ever signed (migration 0012). Status changes on
  // rotation; the key material itself is write-once (DB trigger).
  // An upsert only ever touches the mutable columns: re-saving a key on boot must not
  // try to rewrite created_at / key material (the trigger refuses, migration 0012).
  signing_keys: spec(["key_id", "alg", "public_key_pem", "status", "created_at", "retired_at", "expires_at"], ["key_id"], {
    orderBy: "created_at",
    updateColumns: ["status", "retired_at", "expires_at"]
  }),
  disputes: spec(
    ["id", "operator_id", "round_ref", "kind", "reason", "status", "requested_by", "resolved_by", "resolution_note", "created_at", "resolved_at"],
    ["id"],
    { orderBy: "created_at" }
  ),
  admin_accounts: spec(
    ["id", "username", "scope", "operator_id", "role", "password_hash", "totp_secret", "status", "must_set_password", "totp_enrolled", "failed_attempts", "locked_until", "created_at"],
    ["id"],
    { orderBy: "created_at" }
  ),
  campaigns: spec(
    ["id", "operator_id", "game_id", "name", "currency", "bet_amount", "total_spins", "valid_from", "valid_to", "status", "created_by", "version", "created_at"],
    ["id"],
    { orderBy: "created_at", version: "version" }
  ),
  player_campaigns: spec(
    ["id", "campaign_id", "operator_id", "operator_player_id", "spins_granted", "spins_remaining", "total_won", "status", "version", "created_at", "updated_at"],
    ["id"],
    { orderBy: "created_at", version: "version" }
  ),
  // Write-ahead record of money-moving rounds (migration 0013, modules/rounds/round-intents.ts).
  round_intents: spec(
    ["idempotency_key", "round_ref", "operator_id", "session_id", "operator_player_id", "currency", "debit_type", "debit_amount", "campaign_id", "credit_type", "win_amount", "game_code", "round_type", "feature_ref", "status", "version", "created_at", "updated_at"],
    ["idempotency_key"],
    { orderBy: "created_at", version: "version" }
  ),
  wallet_balances: spec(["balance_key", "amount"], ["balance_key"]),
  wallet_applied: spec(["idempotency_key", "result_jsonb"], ["idempotency_key"], { jsonb: ["result_jsonb"], rename: { result_jsonb: "result" } }),
  wallet_debit_refs: spec(["operator_tx_ref", "balance_key", "amount"], ["operator_tx_ref"])
};

/** Field name an object uses for a given DB column (applies the rename map). */
function fieldForColumn(t: TableSpec, column: string): string {
  return t.rename[column] ?? column;
}

/** Postgres errors worth retrying as-is: connection loss, deadlock, serialization, overload. */
const TRANSIENT_SQLSTATE = /^(08|40|53|57P)/;
function isTransient(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  // No SQLSTATE at all = the connection itself failed (ECONNREFUSED, reset, timeout).
  return typeof code !== "string" || !/^[0-9A-Z]{5}$/.test(code) || TRANSIENT_SQLSTATE.test(code);
}

interface PendingRow {
  table: string;
  row: Record<string, unknown>;
  /** The request that queued it (its trace context object), or null outside a request. */
  owner: object | null;
}

const QUARANTINE_KEEP = 200;
/** Postgres caps one statement at 65,535 bind parameters. */
const MAX_BIND_PARAMS = 60_000;
const MAX_ROWS_PER_STATEMENT = 500;

export class PostgresPersistence implements Persistence {
  private pending: PendingRow[] = [];
  /** The drain in progress (one write transaction at a time). */
  private running: Promise<void> | null = null;
  /** The drain every caller that arrives meanwhile shares: true group commit, one
   *  transaction (and one fsync) for all of them, not one per caller. */
  private next: Promise<void> | null = null;

  /**
   * Resolves when a drain that STARTED after this call has finished, so every row
   * saved before the call is in it (drain() takes the whole queue).
   */
  private scheduleDrain(): Promise<void> {
    if (this.next) return this.next;
    const prev = this.running ?? Promise.resolve();
    const run: Promise<void> = prev
      .catch(() => {})
      .then(() => {
        this.next = null;
        this.running = run;
        return this.drain();
      })
      .finally(() => {
        if (this.running === run) this.running = null;
      });
    this.next = run;
    return run;
  }
  /** Owners whose rows failed, and how. Read (and cleared) by that owner's flush(). */
  private readonly failedOwners = new WeakMap<object, PersistenceError>();
  /** Most recent quarantined rows, newest last. */
  readonly quarantined: QuarantinedRow[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly opts: { onQuarantine?: (q: QuarantinedRow) => void } = {}
  ) {}

  save(table: string, row: object): void {
    if (!TABLES[table]) throw new Error(`unknown persistence table: ${table}`);
    // Snapshot the row now (stores mutate their objects in place after save()).
    this.pending.push({ table, row: { ...(row as Record<string, unknown>) }, owner: currentTrace() ?? null });
  }

  flush(): Promise<void> {
    const owner = currentTrace() ?? null;
    return this.scheduleDrain().then(
      () => this.raiseFor(owner),
      (err) => {
        // This drain failed transiently; rows from an earlier drain may also be ours.
        this.raiseFor(owner, false);
        throw err;
      }
    );
  }

  /** Rejects if rows owned by `owner` failed in any drain since its last flush. */
  private raiseFor(owner: object | null, throwIt = true): void {
    if (!owner) return;
    const err = this.failedOwners.get(owner);
    if (!err) return;
    this.failedOwners.delete(owner);
    if (throwIt) throw err;
  }

  private async drain(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    let client;
    try {
      client = await this.pool.connect();
    } catch (err) {
      this.requeue(batch, err);
      throw new PersistenceError("PERSISTENCE_UNAVAILABLE", "transient", err);
    }
    try {
      await client.query("BEGIN");
      // One multi-row upsert per table (and chunk), not one round trip per row: a
      // drain carries every concurrent request's rows, so this is what group commit
      // costs. No foreign keys exist (0001_core.sql), so table order is free.
      for (const s of this.statements(batch)) await client.query(s.text, s.values);
      await client.query("COMMIT");
      this.committed(batch);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (isTransient(err)) {
        this.requeue(batch, err);
        throw new PersistenceError("PERSISTENCE_UNAVAILABLE", "transient", err);
      }
      // A permanent refusal (constraint/trigger): find the offending rows one by one
      // (savepoints), quarantine them, commit everything else.
      await this.salvage(client, batch, err);
    } finally {
      client.release();
    }
  }

  /** These rows are durable now: a transient error recorded for their owner is stale. */
  private committed(rows: PendingRow[]): void {
    for (const p of rows) if (p.owner && this.failedOwners.get(p.owner)?.kind === "transient") this.failedOwners.delete(p.owner);
  }

  private requeue(batch: PendingRow[], err: unknown): void {
    metrics.dbFlushFailures.inc({ kind: "transient" });
    this.pending = batch.concat(this.pending);
    const e = new PersistenceError("PERSISTENCE_UNAVAILABLE", "transient", err);
    for (const p of batch) if (p.owner) this.failedOwners.set(p.owner, e);
  }

  private async salvage(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, batch: PendingRow[], first: unknown): Promise<void> {
    metrics.dbFlushFailures.inc({ kind: "permanent" });
    try {
      await client.query("BEGIN");
      for (const p of batch) {
        const { text, values } = this.buildUpsert(p.table, p.row);
        await client.query("SAVEPOINT row_sp");
        try {
          await client.query(text, values);
          await client.query("RELEASE SAVEPOINT row_sp");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT row_sp");
          if (isTransient(err)) throw err;
          this.quarantine(p, err);
        }
      }
      await client.query("COMMIT");
      this.committed(batch.filter((p) => !this.isQuarantined(p)));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      // The salvage pass itself hit a transient error: nothing of it was committed.
      // Rows already quarantined stay out; the rest are retried next flush.
      const retry = batch.filter((p) => !this.isQuarantined(p));
      this.requeue(retry, err ?? first);
      throw new PersistenceError("PERSISTENCE_UNAVAILABLE", "transient", err);
    }
  }

  private readonly quarantinedRows = new WeakSet<Record<string, unknown>>();
  private isQuarantined(p: PendingRow): boolean {
    return this.quarantinedRows.has(p.row);
  }

  private quarantine(p: PendingRow, err: unknown): void {
    this.quarantinedRows.add(p.row);
    const q: QuarantinedRow = {
      table: p.table,
      row: p.row,
      error: err instanceof Error ? err.message : String(err),
      code: typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : null,
      at: new Date().toISOString()
    };
    this.quarantined.push(q);
    if (this.quarantined.length > QUARANTINE_KEEP) this.quarantined.shift();
    metrics.dbQuarantined.inc({ table: p.table });
    if (p.owner) this.failedOwners.set(p.owner, new PersistenceError(`PERSISTENCE_REJECTED: ${p.table}: ${q.error}`, "permanent", err));
    try {
      this.opts.onQuarantine?.(q);
    } catch {
      /* reporting must never break the flush */
    }
  }

  /**
   * The batch as multi-row upserts: grouped per table (first-seen order), one row per
   * primary key. A key saved twice in one batch keeps what sequential statements would
   * leave: the LAST snapshot for an upsert, the FIRST for an append-only table (DO
   * NOTHING). One statement can't touch the same key twice (Postgres 21000), hence
   * the dedupe. Chunked under Postgres' 65,535 bind-parameter limit.
   */
  private statements(batch: PendingRow[]): Array<{ text: string; values: unknown[] }> {
    const byTable = new Map<string, Map<string, Record<string, unknown>>>();
    for (const p of batch) {
      const t = TABLES[p.table];
      let rows = byTable.get(p.table);
      if (!rows) byTable.set(p.table, (rows = new Map()));
      const key = JSON.stringify(t.pk.map((c) => p.row[fieldForColumn(t, c)] ?? null));
      if (t.appendOnly && rows.has(key)) continue;
      rows.delete(key); // re-insert so Map order follows the latest save
      rows.set(key, p.row);
    }
    const out: Array<{ text: string; values: unknown[] }> = [];
    for (const [table, rows] of byTable) {
      const all = [...rows.values()];
      const per = Math.max(1, Math.min(MAX_ROWS_PER_STATEMENT, Math.floor(MAX_BIND_PARAMS / TABLES[table].columns.length)));
      for (let i = 0; i < all.length; i += per) out.push(this.buildUpsert(table, all.slice(i, i + per)));
    }
    return out;
  }

  private buildUpsert(table: string, rowOrRows: Record<string, unknown> | Record<string, unknown>[]): { text: string; values: unknown[] } {
    const t = TABLES[table];
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of rows) {
      const placeholders: string[] = [];
      for (const col of t.columns) {
        const field = fieldForColumn(t, col);
        let v = row[field];
        if (v === undefined) v = null;
        if (t.jsonb.has(col) && v !== null) v = JSON.stringify(v);
        values.push(v);
        placeholders.push(t.jsonb.has(col) ? `$${values.length}::jsonb` : `$${values.length}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }
    const cols = t.columns.join(", ");
    const conflict = t.pk.join(", ");
    let onConflict: string;
    if (t.appendOnly) {
      onConflict = "DO NOTHING";
    } else {
      const updates = (t.updateColumns ?? t.columns.filter((c) => !t.pk.includes(c))).map((c) => `${c} = EXCLUDED.${c}`).join(", ");
      onConflict = updates ? `DO UPDATE SET ${updates}` : "DO NOTHING";
      if (updates && t.version) onConflict += ` WHERE ${table}.${t.version} < EXCLUDED.${t.version}`;
    }
    const text = `INSERT INTO ${table} (${cols}) VALUES ${tuples.join(", ")} ON CONFLICT (${conflict}) ${onConflict}`;
    return { text, values };
  }

  async loadTable(table: string): Promise<Record<string, unknown>[]> {
    return this.loadRows(table);
  }

  /**
   * Rows of `table` shaped exactly like the app's objects (renames applied, NULLs the
   * app never wrote left off), optionally filtered: `where` is a SQL condition over the
   * table's columns with $1.. placeholders. Rows come oldest first (the table's order
   * column) unless `newestFirst`. Used by hydrate and by modules/history.
   */
  async loadRows(
    table: string,
    opts: { where?: string; params?: unknown[]; newestFirst?: boolean; limit?: number } = {}
  ): Promise<Record<string, unknown>[]> {
    const t = TABLES[table];
    if (!t) throw new Error(`unknown persistence table: ${table}`);
    const where = opts.where ? ` WHERE ${opts.where}` : "";
    const order = t.orderBy ? ` ORDER BY ${t.orderBy} ${opts.newestFirst ? "DESC" : "ASC"}` : "";
    const limit = opts.limit ? ` LIMIT ${Math.floor(opts.limit)}` : "";
    const res = await this.pool.query(`SELECT ${t.columns.join(", ")} FROM ${table}${where}${order}${limit}`, opts.params ?? []);
    const rows = res.rows.map((dbRow: Record<string, unknown>) => {
      const obj: Record<string, unknown> = {};
      for (const col of t.columns) {
        if (dbRow[col] === null && t.omitNull.has(col)) continue;
        obj[fieldForColumn(t, col)] = dbRow[col];
      }
      return obj;
    });
    return opts.newestFirst ? rows.reverse() : rows;
  }

  /** Raw read query (history reports). */
  query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    return this.pool.query(text, params) as unknown as Promise<{ rows: Record<string, unknown>[] }>;
  }
}
