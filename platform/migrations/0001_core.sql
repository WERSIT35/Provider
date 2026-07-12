-- 0001_core.sql — Banana X platform schema (app-aligned).
--
-- This schema matches exactly what the application persists (see src/persistence).
-- The platform is MEMORY-FIRST: the in-memory stores are the read source of truth,
-- and every mutation is written through to these tables (loaded back on boot). So:
--   • money is numeric(14,2) — the same decimal amounts the engine/reporting use
--     (a real-money production build would move to integer minor units)
--   • append-only ledgers (rounds, audit_records, round_adjustments,
--     wallet_transactions) are protected by an UPDATE/DELETE-deny trigger; the app
--     only ever INSERTs (re-flush uses ON CONFLICT DO NOTHING, which never UPDATEs)
--   • foreign keys are intentionally omitted so a per-request write-through batch can
--     never fail on ordering; integrity is enforced by the application layer
--
-- PostgreSQL. Time is stored UTC (ISO strings from the app).
-- NOTE: the migration runner (src/db/migrate.ts) wraps each file in a transaction
-- and owns the schema_migrations bookkeeping, so this file has no BEGIN/COMMIT.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ── Tenancy & identity ────────────────────────────────────────────────────────
CREATE TABLE operators (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'sandbox',
  default_currency text NOT NULL DEFAULT 'GEL',
  created_at       timestamptz NOT NULL
);

CREATE TABLE operator_domains (
  id          text PRIMARY KEY,
  operator_id text NOT NULL,
  domain      text NOT NULL,
  environment text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL
);
CREATE INDEX ix_domains_operator ON operator_domains (operator_id);

CREATE TABLE operator_api_credentials (
  id           text PRIMARY KEY,
  operator_id  text NOT NULL,
  api_key_id   text NOT NULL UNIQUE,
  secret_hash  text NOT NULL,
  secret_last4 text NOT NULL,
  -- Raw HMAC secret. DEV/SKELETON ONLY — production keeps this in a secret manager
  -- and stores only a reference here.
  hmac_secret  text,
  environment  text NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  ip_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz
);
CREATE INDEX ix_cred_operator ON operator_api_credentials (operator_id);

-- ── Games & math configs ──────────────────────────────────────────────────────
CREATE TABLE games (
  id         text PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  title      text NOT NULL,
  status     text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL
);

CREATE TABLE math_configs (
  id              text PRIMARY KEY,
  game_id         text NOT NULL,
  version         text NOT NULL,
  rtp_profile_key text NOT NULL,
  theoretical_rtp numeric(7,3) NOT NULL,
  config_hash     text NOT NULL,
  status          text NOT NULL DEFAULT 'draft',
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL
);

CREATE TABLE operator_games (
  id             text PRIMARY KEY,
  operator_id    text NOT NULL,
  game_id        text NOT NULL,
  math_config_id text NOT NULL,
  currency       text NOT NULL,
  jurisdiction   text NOT NULL DEFAULT 'GE',
  allowed_bets   jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'enabled',
  created_at     timestamptz NOT NULL
);
CREATE INDEX ix_opgames_operator ON operator_games (operator_id);

-- ── Play & money (durable mirror of the in-memory system of record) ────────────
CREATE TABLE player_sessions (
  id                         text PRIMARY KEY,
  operator_id                text NOT NULL,
  game_id                    text NOT NULL,
  game_code                  text NOT NULL,
  math_config_id             text NOT NULL,
  operator_player_id         text NOT NULL,
  currency                   text NOT NULL,
  allowed_bets               jsonb NOT NULL,
  status                     text NOT NULL DEFAULT 'active',
  free_spins_left            int NOT NULL DEFAULT 0,
  free_spin_multiplier_carry numeric(14,2) NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL
);
CREATE INDEX ix_sessions_operator ON player_sessions (operator_id);

-- Immutable, hash-chained round ledger (see src/modules/ledger).
CREATE TABLE rounds (
  id                 text PRIMARY KEY,
  seq                bigint NOT NULL,
  round_ref          text NOT NULL UNIQUE,
  session_id         text NOT NULL,
  operator_id        text NOT NULL,
  operator_player_id text NOT NULL,
  game_id            text NOT NULL,
  math_config_id     text NOT NULL,
  bet_amount         numeric(14,2) NOT NULL,
  bet_charged        numeric(14,2) NOT NULL,
  is_free_spin       boolean NOT NULL DEFAULT false,
  ante_enabled       boolean NOT NULL DEFAULT false,
  rng_seed_hex       text NOT NULL,
  rng_algo           text NOT NULL,
  rng_bytes_drawn    int NOT NULL,
  outcome_hash       text NOT NULL,
  total_win          numeric(14,2) NOT NULL,
  multiplier_applied numeric(14,2) NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'resolved',
  pre_state          jsonb,
  outcome_jsonb      jsonb NOT NULL,
  prev_hash          text NOT NULL,
  payload_hash       text NOT NULL,
  chain_hash         text NOT NULL,
  created_at         timestamptz NOT NULL
);
CREATE INDEX ix_rounds_operator      ON rounds (operator_id, seq);
CREATE INDEX ix_rounds_player        ON rounds (operator_id, operator_player_id);
CREATE INDEX ix_rounds_session       ON rounds (session_id);

CREATE TABLE wallet_transactions (
  id              text PRIMARY KEY,
  seq             bigint NOT NULL,
  operator_id     text NOT NULL,
  session_id      text NOT NULL,
  round_ref       text NOT NULL,
  type            text NOT NULL CHECK (type IN ('DEBIT','CREDIT','ROLLBACK','ADJUSTMENT')),
  amount          numeric(14,2) NOT NULL,
  currency        text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  operator_tx_ref text,
  status          text NOT NULL,
  error_code      text,
  created_at      timestamptz NOT NULL
);
CREATE INDEX ix_tx_round    ON wallet_transactions (round_ref);
CREATE INDEX ix_tx_operator ON wallet_transactions (operator_id);

-- Append-only overlay recording admin void/settle actions on rounds.
CREATE TABLE round_adjustments (
  id                 text PRIMARY KEY,
  seq                bigint NOT NULL,
  round_ref          text NOT NULL,
  operator_id        text NOT NULL,
  operator_player_id text NOT NULL,
  kind               text NOT NULL,
  effective_status   text NOT NULL,
  reason             text NOT NULL,
  actor_id           text NOT NULL,
  wallet_tx_refs     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL
);
CREATE INDEX ix_adj_round    ON round_adjustments (round_ref);
CREATE INDEX ix_adj_operator ON round_adjustments (operator_id);

CREATE TABLE audit_records (
  id           text PRIMARY KEY,
  seq          bigint NOT NULL,
  operator_id  text,
  actor_type   text NOT NULL,
  actor_id     text NOT NULL,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  payload_hash text NOT NULL,
  prev_hash    text NOT NULL,
  chain_hash   text NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX ix_audit_operator ON audit_records (operator_id);
CREATE INDEX ix_audit_action   ON audit_records (action);

-- Operator↔provider dispute queue (mutable: status transitions on resolve).
CREATE TABLE disputes (
  id              text PRIMARY KEY,
  operator_id     text NOT NULL,
  round_ref       text NOT NULL,
  kind            text NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  requested_by    text NOT NULL,
  resolved_by     text,
  resolution_note text,
  created_at      timestamptz NOT NULL,
  resolved_at     timestamptz
);
CREATE INDEX ix_disputes_operator ON disputes (operator_id);

-- ── Sandbox wallet (demo player funds; a real build uses the operator's wallet) ──
CREATE TABLE wallet_balances (
  balance_key text PRIMARY KEY,   -- "<operator_player_id>:<currency>"
  amount      numeric(14,2) NOT NULL
);
CREATE TABLE wallet_applied (       -- idempotency: keyed results of applied ops
  idempotency_key text PRIMARY KEY,
  result_jsonb    jsonb NOT NULL
);
CREATE TABLE wallet_debit_refs (    -- lets a rollback reverse the exact debit
  operator_tx_ref text PRIMARY KEY,
  balance_key     text NOT NULL,
  amount          numeric(14,2) NOT NULL
);

-- ── Append-only protection (defense in depth) ─────────────────────────────────
CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rounds_no_mutate     BEFORE UPDATE OR DELETE ON rounds             FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER trg_audit_no_mutate      BEFORE UPDATE OR DELETE ON audit_records      FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER trg_adjustments_no_mutate BEFORE UPDATE OR DELETE ON round_adjustments FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER trg_tx_no_mutate         BEFORE UPDATE OR DELETE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION deny_mutation();
