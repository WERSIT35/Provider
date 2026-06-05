-- 0001_core.sql — Banana X platform core schema (plan §3)
-- PostgreSQL. Money is stored as integer minor units (+ currency); time is UTC.
-- Append-only tables (rounds, wallet_transactions, audit_records) are protected by
-- triggers below AND by NOT granting UPDATE/DELETE to the application role in prod.
--
-- This migration is the Phase 2/3 foundation. Later phases add reports/invoices and
-- jurisdiction/RG tables. Apply with your migration runner (e.g. node-pg-migrate / Prisma).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ── Tenancy & identity ────────────────────────────────────────────────────────
CREATE TABLE operators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'sandbox' CHECK (status IN ('sandbox','live','suspended')),
  default_currency text NOT NULL DEFAULT 'GEL',
  timezone         text NOT NULL DEFAULT 'UTC',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operator_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  domain      text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','prod')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, domain, environment)
);

CREATE TABLE operator_api_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES operators(id),
  api_key_id     text NOT NULL UNIQUE,
  hmac_secret_ref text NOT NULL,              -- pointer into secret manager; never the raw secret
  environment    text NOT NULL CHECK (environment IN ('sandbox','prod')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','rotating','revoked')),
  ip_allowlist   text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  last_used_at   timestamptz
);
CREATE INDEX ix_cred_operator_status ON operator_api_credentials (operator_id, status);

CREATE TABLE admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid REFERENCES operators(id),  -- NULL = provider/internal staff
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  mfa_secret_ref text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('provider','operator')),
  key   text NOT NULL UNIQUE,
  name  text NOT NULL
);
CREATE TABLE permissions (
  id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE
);
CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES admin_users(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

-- ── Games & math configs ──────────────────────────────────────────────────────
CREATE TABLE games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  title           text NOT NULL,
  provider_studio text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','certified','live','retired')),
  layout          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid NOT NULL REFERENCES games(id),
  semver             text NOT NULL,
  client_bundle_hash text,
  engine_hash        text,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','candidate','certified','live','retired')),
  certified_by       text,
  certified_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, semver)
);

CREATE TABLE math_configs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              uuid NOT NULL REFERENCES games(id),
  version              text NOT NULL,
  rtp_profile_key      text NOT NULL,
  theoretical_rtp      numeric(6,3) NOT NULL,
  config_jsonb         jsonb NOT NULL,
  config_hash          text NOT NULL,           -- sha256 of canonical config
  signature            text,                    -- provider signing key
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','in_review','approved','active','archived')),
  approved_by          text,
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, version, rtp_profile_key)
);

CREATE TABLE operator_games (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES operators(id),
  game_id        uuid NOT NULL REFERENCES games(id),
  math_config_id uuid NOT NULL REFERENCES math_configs(id),
  min_bet        bigint NOT NULL,
  max_bet        bigint NOT NULL,
  allowed_bets   jsonb NOT NULL,
  currency       text NOT NULL,
  jurisdiction   text NOT NULL DEFAULT 'GE',
  status         text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, game_id, currency, jurisdiction)
);

-- ── Play & money (system of record) ───────────────────────────────────────────
CREATE TABLE player_sessions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id                uuid NOT NULL REFERENCES operators(id),
  game_id                    uuid NOT NULL REFERENCES games(id),
  math_config_id             uuid NOT NULL REFERENCES math_configs(id),
  operator_player_id         text NOT NULL,
  currency                   text NOT NULL,
  locale                     text NOT NULL DEFAULT 'en',
  launch_token_id            text,
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','closed')),
  free_spins_left            int NOT NULL DEFAULT 0,
  free_spin_multiplier_carry numeric(12,2) NOT NULL DEFAULT 0,
  bonus_round_win            bigint NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  expires_at                 timestamptz,
  closed_at                  timestamptz
);
CREATE INDEX ix_sessions_operator_created ON player_sessions (operator_id, created_at DESC);
CREATE INDEX ix_sessions_status_expiry    ON player_sessions (status, expires_at);

-- Immutable round ledger (hash-chained). See platform memory-repositories.ts for the
-- same semantics; here the chain is enforced + protected against UPDATE/DELETE.
CREATE TABLE rounds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                bigserial NOT NULL,
  round_ref          text NOT NULL UNIQUE,
  session_id         uuid NOT NULL REFERENCES player_sessions(id),
  operator_id        uuid NOT NULL REFERENCES operators(id),
  game_id            uuid NOT NULL REFERENCES games(id),
  math_config_id     uuid NOT NULL REFERENCES math_configs(id),
  bet_amount         bigint NOT NULL,
  bet_charged        bigint NOT NULL,
  is_free_spin       boolean NOT NULL DEFAULT false,
  ante_enabled       boolean NOT NULL DEFAULT false,
  rng_seed_ref       text NOT NULL,           -- encrypted seed pointer (or sealed seed)
  rng_algo           text NOT NULL,
  rng_bytes_drawn    int NOT NULL,
  outcome_jsonb      jsonb NOT NULL,
  outcome_hash       text NOT NULL,
  total_win          bigint NOT NULL,
  multiplier_applied numeric(12,2) NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'resolved' CHECK (status IN ('resolved','settled','void')),
  prev_hash          text NOT NULL,
  payload_hash       text NOT NULL,
  chain_hash         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rounds_operator_created ON rounds (operator_id, created_at DESC);
CREATE INDEX ix_rounds_session          ON rounds (session_id);
CREATE INDEX ix_rounds_status           ON rounds (status);

CREATE TABLE wallet_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  session_id      uuid NOT NULL REFERENCES player_sessions(id),
  round_id        uuid REFERENCES rounds(id),
  type            text NOT NULL CHECK (type IN ('DEBIT','CREDIT','ROLLBACK')),
  amount          bigint NOT NULL,
  currency        text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  operator_tx_ref text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','failed','rolled_back')),
  attempt_count   int NOT NULL DEFAULT 0,
  request_jsonb   jsonb,
  response_jsonb  jsonb,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz
);
CREATE INDEX ix_tx_round            ON wallet_transactions (round_id);
CREATE INDEX ix_tx_status_created   ON wallet_transactions (status, created_at);
CREATE UNIQUE INDEX ux_tx_operator_ref ON wallet_transactions (operator_id, operator_tx_ref)
  WHERE operator_tx_ref IS NOT NULL;

CREATE TABLE rollback_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_tx_id  uuid NOT NULL REFERENCES wallet_transactions(id),
  round_id        uuid REFERENCES rounds(id),
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigserial NOT NULL,
  operator_id  uuid REFERENCES operators(id),
  actor_type   text NOT NULL CHECK (actor_type IN ('admin','system','operator')),
  actor_id     text NOT NULL,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  payload_hash text NOT NULL,
  prev_hash    text NOT NULL,
  chain_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_operator_created ON audit_records (operator_id, created_at DESC);
CREATE INDEX ix_audit_action           ON audit_records (action);

CREATE TABLE api_request_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid REFERENCES operators(id),
  api_key_id      text,
  endpoint        text NOT NULL,
  method          text NOT NULL,
  request_id      text NOT NULL,
  idempotency_key text,
  ip              inet,
  signature_valid boolean,
  status_code     int,
  latency_ms      int,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_reqlog_operator_created ON api_request_logs (operator_id, created_at DESC);
CREATE INDEX ix_reqlog_request_id       ON api_request_logs (request_id);

-- ── Append-only protection ────────────────────────────────────────────────────
-- Block UPDATE/DELETE on the immutable ledgers at the DB layer (defense in depth;
-- the app role should also lack UPDATE/DELETE grants on these tables).
CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rounds_no_mutate
  BEFORE UPDATE OR DELETE ON rounds
  FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER trg_audit_no_mutate
  BEFORE UPDATE OR DELETE ON audit_records
  FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- NOTE: wallet_transactions transitions status (pending→confirmed/…); it is append-only
-- in spirit but needs controlled status updates, so it is NOT covered by deny_mutation.
-- Restrict it via a stored-proc / row-state-machine + column-level grants instead.

COMMIT;
