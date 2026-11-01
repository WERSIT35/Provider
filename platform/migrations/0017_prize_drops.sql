-- 0017_prize_drops.sql — Prize Drops: cash prizes dropped on qualifying rounds after
-- they were played (modules/promotions, jobs/promotions.ts). Their prizes are
-- promo_wins rows (0016) with round_ref set, paid as PROMO_WIN credits.
--
-- The sweep examines each operator's rounds in ledger order and remembers how far it got
-- (cursor_seq); each qualifying round wins with chance 1/odds while prizes are left.
-- Same conventions as 0016 (versioned upserts, numeric money, no foreign keys).

CREATE TABLE prize_drops (
  id           text PRIMARY KEY,
  operator_id  text NOT NULL,
  name         text NOT NULL,
  game_codes   jsonb NOT NULL,
  currency     text NOT NULL,
  min_bet      numeric(14,2) NOT NULL CHECK (min_bet >= 0),
  odds         integer NOT NULL CHECK (odds BETWEEN 1 AND 1000000),
  prizes       jsonb NOT NULL,                    -- [{ amount, count }], one tier per amount
  prizes_left  integer NOT NULL CHECK (prizes_left >= 0),
  cursor_seq   bigint NOT NULL DEFAULT -1,        -- last round ledger seq examined
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('open','closed','cancelled')),
  created_by   text NOT NULL,
  closed_at    timestamptz,
  version      bigint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK (status = 'open' OR closed_at IS NOT NULL)
);
CREATE INDEX ix_prize_drops_operator ON prize_drops (operator_id, created_at);
