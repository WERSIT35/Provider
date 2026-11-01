-- 0016_promotions.sql — operator promotions: Tournaments, and the cash prizes
-- promotions pay (promo_wins; prize drops add their table in a later migration).
--
-- A promotion never touches a game's math or a round: tournaments rank players on the
-- rounds they already played (read from the round ledger). Prizes are the operator's money, paid to the player
-- through the casino wallet as a credit tagged PROMO_WIN (never counted as a round win,
-- so round-vs-wallet reconciliation is unchanged).
--
-- Same conventions as 0002: memory-first write-through, numeric(14,2) money, UTC
-- timestamps, versioned upserts (a stale flush never overwrites a newer row), no
-- foreign keys. The CHECKs repeat the application's invariants as the last line of defence.

CREATE TABLE tournaments (
  id           text PRIMARY KEY,
  operator_id  text NOT NULL,
  name         text NOT NULL,
  game_codes   jsonb NOT NULL,                    -- games whose rounds count
  currency     text NOT NULL,
  metric       text NOT NULL CHECK (metric IN ('max_multiplier','total_win','turnover')),
  min_bet      numeric(14,2) NOT NULL CHECK (min_bet >= 0),
  prizes       jsonb NOT NULL,                    -- amount per rank, rank 1 first
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('open','closed','cancelled')),
  created_by   text NOT NULL,
  closed_at    timestamptz,
  version      bigint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ix_tournaments_operator ON tournaments (operator_id, created_at);

CREATE TABLE promo_wins (
  id                 text PRIMARY KEY,
  operator_id        text NOT NULL,
  promo_type         text NOT NULL CHECK (promo_type IN ('tournament','prize_drop')),
  promo_id           text NOT NULL,
  promo_name         text NOT NULL,
  operator_player_id text NOT NULL,
  currency           text NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  rank               integer,                     -- tournaments
  score              numeric(20,4),               -- tournaments: the ranked value
  round_ref          text,                        -- prize drops: the round that won
  status             text NOT NULL CHECK (status IN ('pending','paid','failed')),
  operator_tx_ref    text,
  error_code         text,
  attempts           integer NOT NULL DEFAULT 0,
  version            bigint NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL,
  paid_at            timestamptz,
  CHECK ((promo_type = 'tournament') = (rank IS NOT NULL)),
  CHECK ((promo_type = 'prize_drop') = (round_ref IS NOT NULL)),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
-- One prize per rank per tournament; one prize per round per drop.
CREATE UNIQUE INDEX ux_promo_wins_rank ON promo_wins (promo_id, rank) WHERE rank IS NOT NULL;
CREATE UNIQUE INDEX ux_promo_wins_round ON promo_wins (promo_id, round_ref) WHERE round_ref IS NOT NULL;
CREATE INDEX ix_promo_wins_player ON promo_wins (operator_id, operator_player_id, created_at);
CREATE INDEX ix_promo_wins_open ON promo_wins (status) WHERE status <> 'paid';

-- ── Money ledger: the prize credit ─────────────────────────────────────────────
ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('DEBIT','CREDIT','ROLLBACK','ADJUSTMENT','FREE_ROUND_BET','FREE_ROUND_WIN','PROMO_WIN'));
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_promo_win_positive_check
  CHECK (type <> 'PROMO_WIN' OR amount > 0);
