import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type * as Sqlite from "node:sqlite";

/**
 * The casino's own durable store: players, provider registry, the wallet ledger written
 * by the RGS webhooks, and staff sessions. SQLite via Node's built-in `node:sqlite`
 * (zero dependencies, zero config — a single file on disk).
 *
 * Loaded through process.getBuiltinModule rather than `import`, because Vite (vitest)
 * does not yet recognise `node:sqlite` as a builtin and would try to resolve "sqlite".
 */
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof Sqlite;

export type CasinoDatabase = Sqlite.DatabaseSync;

/**
 * Forward-only migrations; PRAGMA user_version records how many have been applied.
 * Never edit an applied entry — append a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    balance_minor  INTEGER NOT NULL CHECK (balance_minor >= 0),
    created_at     TEXT NOT NULL
  );

  CREATE TABLE providers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    platform_url    TEXT NOT NULL,
    operator_id     TEXT NOT NULL,
    api_key_id      TEXT NOT NULL,
    api_secret      TEXT NOT NULL,
    webhook_secret  TEXT NOT NULL,
    admin_token     TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  -- One row per money movement the RGS asked us to make, exactly as signed in the webhook.
  -- Append-only (triggers below): corrections are new rows (a rollback), never edits.
  CREATE TABLE wallet_transactions (
    seq                  INTEGER PRIMARY KEY AUTOINCREMENT,
    id                   TEXT NOT NULL UNIQUE,
    provider_id          TEXT NOT NULL,
    player_id            TEXT NOT NULL REFERENCES players(id),
    kind                 TEXT NOT NULL CHECK (kind IN ('debit', 'credit', 'rollback')),
    tx_type              TEXT NOT NULL CHECK (tx_type IN ('WAGER', 'FREE_ROUND_BET', 'CREDIT', 'FREE_ROUND_WIN', 'ROLLBACK')),
    amount_minor         INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency             TEXT NOT NULL,
    round_ref            TEXT NOT NULL,
    game_code            TEXT,
    round_type           TEXT CHECK (round_type IS NULL OR round_type IN ('paid', 'free_spin', 'buy', 'free_round')),
    campaign_id          TEXT,
    idempotency_key      TEXT NOT NULL,
    operator_tx_ref      TEXT NOT NULL UNIQUE,
    reverses_tx_ref      TEXT REFERENCES wallet_transactions(operator_tx_ref),
    balance_after_minor  INTEGER NOT NULL,
    created_at           TEXT NOT NULL,
    UNIQUE (provider_id, idempotency_key),
    CHECK ((kind = 'rollback') = (reverses_tx_ref IS NOT NULL)),
    CHECK (tx_type <> 'FREE_ROUND_BET' OR amount_minor = 0)
  );
  CREATE UNIQUE INDEX ux_tx_single_rollback ON wallet_transactions (reverses_tx_ref) WHERE reverses_tx_ref IS NOT NULL;
  CREATE INDEX ix_tx_round  ON wallet_transactions (round_ref);
  CREATE INDEX ix_tx_player ON wallet_transactions (player_id, seq);

  CREATE TRIGGER wallet_transactions_no_update BEFORE UPDATE ON wallet_transactions
  BEGIN SELECT RAISE(ABORT, 'wallet_transactions is append-only'); END;
  CREATE TRIGGER wallet_transactions_no_delete BEFORE DELETE ON wallet_transactions
  BEGIN SELECT RAISE(ABORT, 'wallet_transactions is append-only'); END;

  -- Back-office staff sessions. Only a SHA-256 of the cookie token is stored.
  CREATE TABLE staff_sessions (
    token_hash  TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
  `,
  // 2 — bonus grouping. feature_ref = the round_ref of the round that triggered the
  // provider's free-spins feature, sent as featureRef on every free-spin money move.
  // A bonus is that trigger round plus every row carrying its ref. NULL elsewhere
  // (and on rows written before this column). ADD COLUMN is not an UPDATE, so the
  // append-only triggers are untouched.
  `
  ALTER TABLE wallet_transactions ADD COLUMN feature_ref TEXT;
  CREATE INDEX ix_tx_feature ON wallet_transactions (feature_ref) WHERE feature_ref IS NOT NULL;
  `,
  // 3 — voided debits. The RGS reverses a debit whose response it lost by naming the
  // debit's idempotency key. When we never received that debit, nothing moves, but the
  // key is recorded here so the debit is refused if it arrives late (TRANSACTION_VOIDED).
  // Not a money row, so it lives outside wallet_transactions. Append-only too.
  `
  CREATE TABLE voided_debits (
    provider_id               TEXT NOT NULL,
    idempotency_key           TEXT NOT NULL,
    rollback_idempotency_key  TEXT NOT NULL,
    player_id                 TEXT,
    round_ref                 TEXT NOT NULL,
    void_ref                  TEXT NOT NULL UNIQUE,
    created_at                TEXT NOT NULL,
    PRIMARY KEY (provider_id, idempotency_key),
    UNIQUE (provider_id, rollback_idempotency_key)
  );
  CREATE TRIGGER voided_debits_no_update BEFORE UPDATE ON voided_debits
  BEGIN SELECT RAISE(ABORT, 'voided_debits is append-only'); END;
  CREATE TRIGGER voided_debits_no_delete BEFORE DELETE ON voided_debits
  BEGIN SELECT RAISE(ABORT, 'voided_debits is append-only'); END;
  `,
  // 4 — W3C trace id of the provider request that made the move (the webhook's
  // `traceparent`), so one player action can be followed from the game through the
  // provider's ledger into ours. NULL on older rows and on calls sent without it.
  `
  ALTER TABLE wallet_transactions ADD COLUMN trace_id TEXT;
  CREATE INDEX ix_tx_trace ON wallet_transactions (trace_id) WHERE trace_id IS NOT NULL;
  `
];

/** Open (creating if needed) the casino database and bring its schema up to date. */
export function openCasinoDb(path = ":memory:"): CasinoDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: CasinoDatabase): void {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    inTransaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run `fn` atomically (BEGIN IMMEDIATE … COMMIT, ROLLBACK on throw). Not re-entrant. */
export function inTransaction<T>(db: CasinoDatabase, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Money crosses the API as decimal major units; the database stores integer minor units. */
export const toMinor = (amount: number): number => Math.round(Number(amount) * 100);
export const toMajor = (minor: number): number => Number((Number(minor) / 100).toFixed(2));
