import type { Pool } from "pg";

/**
 * Write-through persistence port. The in-memory stores stay the read source of
 * truth; when a Persistence is present they ENQUEUE an upsert on every mutation,
 * and the request boundary (an app onSend hook) calls flush() to drain the queue
 * into Postgres in one transaction. On boot the stores hydrate() from loadTable().
 *
 * `save()` is synchronous (callable from the existing sync store methods); the
 * actual DB write is deferred to flush(). A no-op NullPersistence lets stores stay
 * unconditional.
 */
export interface Persistence {
  /** Enqueue an upsert of `row` into `table` (flushed at the request boundary). */
  save(table: string, row: object): void;
  flush(): Promise<void>;
  loadTable(table: string): Promise<Record<string, unknown>[]>;
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
}

function spec(
  columns: string[],
  pk: string[],
  opts: { jsonb?: string[]; appendOnly?: boolean; rename?: Record<string, string>; orderBy?: string } = {}
): TableSpec {
  return {
    columns,
    pk,
    jsonb: new Set(opts.jsonb ?? []),
    appendOnly: Boolean(opts.appendOnly),
    rename: opts.rename ?? {},
    orderBy: opts.orderBy
  };
}

/** The single source of table shapes shared by save() and loadTable(). */
const TABLES: Record<string, TableSpec> = {
  operators: spec(["id", "name", "slug", "status", "default_currency", "created_at"], ["id"], { orderBy: "created_at" }),
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
    ["id", "operator_id", "game_id", "math_config_id", "currency", "jurisdiction", "allowed_bets", "status", "created_at"],
    ["id"],
    { jsonb: ["allowed_bets"], orderBy: "created_at" }
  ),
  player_sessions: spec(
    ["id", "operator_id", "game_id", "game_code", "math_config_id", "operator_player_id", "currency", "allowed_bets", "status", "free_spins_left", "free_spin_multiplier_carry", "created_at"],
    ["id"],
    { jsonb: ["allowed_bets"], orderBy: "created_at" }
  ),
  rounds: spec(
    ["id", "seq", "round_ref", "session_id", "operator_id", "operator_player_id", "game_id", "math_config_id", "bet_amount", "bet_charged", "is_free_spin", "ante_enabled", "rng_seed_hex", "rng_algo", "rng_bytes_drawn", "outcome_hash", "total_win", "multiplier_applied", "status", "pre_state", "outcome_jsonb", "prev_hash", "payload_hash", "chain_hash", "created_at"],
    ["id"],
    { jsonb: ["pre_state", "outcome_jsonb"], appendOnly: true, rename: { outcome_jsonb: "outcome" }, orderBy: "seq" }
  ),
  wallet_transactions: spec(
    ["id", "seq", "operator_id", "session_id", "round_ref", "type", "amount", "currency", "idempotency_key", "operator_tx_ref", "status", "error_code", "created_at"],
    ["id"],
    { appendOnly: true, orderBy: "seq" }
  ),
  round_adjustments: spec(
    ["id", "seq", "round_ref", "operator_id", "operator_player_id", "kind", "effective_status", "reason", "actor_id", "wallet_tx_refs", "created_at"],
    ["id"],
    { jsonb: ["wallet_tx_refs"], appendOnly: true, orderBy: "seq" }
  ),
  audit_records: spec(
    ["id", "seq", "operator_id", "actor_type", "actor_id", "action", "target_type", "target_id", "payload_hash", "prev_hash", "chain_hash", "created_at"],
    ["id"],
    { appendOnly: true, orderBy: "seq" }
  ),
  disputes: spec(
    ["id", "operator_id", "round_ref", "kind", "reason", "status", "requested_by", "resolved_by", "resolution_note", "created_at", "resolved_at"],
    ["id"],
    { orderBy: "created_at" }
  ),
  wallet_balances: spec(["balance_key", "amount"], ["balance_key"]),
  wallet_applied: spec(["idempotency_key", "result_jsonb"], ["idempotency_key"], { jsonb: ["result_jsonb"], rename: { result_jsonb: "result" } }),
  wallet_debit_refs: spec(["operator_tx_ref", "balance_key", "amount"], ["operator_tx_ref"])
};

/** Field name an object uses for a given DB column (applies the rename map). */
function fieldForColumn(t: TableSpec, column: string): string {
  return t.rename[column] ?? column;
}

export class PostgresPersistence implements Persistence {
  private pending: Array<{ table: string; row: Record<string, unknown> }> = [];

  constructor(private readonly pool: Pool) {}

  save(table: string, row: object): void {
    if (!TABLES[table]) throw new Error(`unknown persistence table: ${table}`);
    // Snapshot the row now (stores mutate their objects in place after save()).
    this.pending.push({ table, row: { ...(row as Record<string, unknown>) } });
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const { table, row } of batch) {
        const { text, values } = this.buildUpsert(table, row);
        await client.query(text, values);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      // Re-queue the batch so a transient failure doesn't silently drop writes.
      this.pending = batch.concat(this.pending);
      throw err;
    } finally {
      client.release();
    }
  }

  private buildUpsert(table: string, row: Record<string, unknown>): { text: string; values: unknown[] } {
    const t = TABLES[table];
    const values: unknown[] = [];
    const placeholders: string[] = [];
    t.columns.forEach((col, i) => {
      const field = fieldForColumn(t, col);
      let v = row[field];
      if (v === undefined) v = null;
      if (t.jsonb.has(col) && v !== null) v = JSON.stringify(v);
      values.push(v);
      placeholders.push(t.jsonb.has(col) ? `$${i + 1}::jsonb` : `$${i + 1}`);
    });
    const cols = t.columns.join(", ");
    const conflict = t.pk.join(", ");
    let onConflict: string;
    if (t.appendOnly) {
      onConflict = "DO NOTHING";
    } else {
      const updates = t.columns.filter((c) => !t.pk.includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(", ");
      onConflict = updates ? `DO UPDATE SET ${updates}` : "DO NOTHING";
    }
    const text = `INSERT INTO ${table} (${cols}) VALUES (${placeholders.join(", ")}) ON CONFLICT (${conflict}) ${onConflict}`;
    return { text, values };
  }

  async loadTable(table: string): Promise<Record<string, unknown>[]> {
    const t = TABLES[table];
    if (!t) throw new Error(`unknown persistence table: ${table}`);
    const order = t.orderBy ? ` ORDER BY ${t.orderBy} ASC` : "";
    const res = await this.pool.query(`SELECT ${t.columns.join(", ")} FROM ${table}${order}`);
    return res.rows.map((dbRow: Record<string, unknown>) => {
      const obj: Record<string, unknown> = {};
      for (const col of t.columns) obj[fieldForColumn(t, col)] = dbRow[col];
      return obj;
    });
  }
}
