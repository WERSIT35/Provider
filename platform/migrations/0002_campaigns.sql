-- 0002_campaigns.sql — operator-granted Free Rounds (Campaign Manager).
--
-- These are NOT the engine's scatter-triggered free spins (player_sessions.free_spins_left):
-- a free round is a normal paid-math spin at the campaign's locked bet, funded by the
-- operator's promotion instead of the player's balance. RTP math is unchanged.
--
-- Same conventions as 0001: memory-first write-through, money numeric(14,2), UTC
-- timestamps, no foreign keys (integrity is enforced in the application layer).
--
-- Concurrency: the in-memory repository is the arbiter (a synchronous
-- check-and-decrement), and every mutation bumps `version`. The write-through
-- upsert only applies a row whose version is NEWER than the stored one, so a stale or
-- re-queued flush can never resurrect consumed spins. The CHECK constraints below are
-- the last line of defence.

CREATE TABLE campaigns (
  id           text PRIMARY KEY,
  operator_id  text NOT NULL,
  game_id      text NOT NULL,
  name         text NOT NULL,
  currency     text NOT NULL,
  bet_amount   numeric(14,2) NOT NULL CHECK (bet_amount > 0),  -- locked bet fed to the engine
  total_spins  integer NOT NULL CHECK (total_spins > 0),        -- spins granted to EACH player
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('active','cancelled')),
  created_by   text NOT NULL,
  version      bigint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL,
  CHECK (valid_to > valid_from)
);
CREATE INDEX ix_campaigns_operator ON campaigns (operator_id, created_at);

CREATE TABLE player_campaigns (
  id                 text PRIMARY KEY,
  campaign_id        text NOT NULL,
  operator_id        text NOT NULL,                 -- denormalised for tenant-scoped lookups
  operator_player_id text NOT NULL,                 -- player ids are unique per operator only
  spins_granted      integer NOT NULL CHECK (spins_granted > 0),
  spins_remaining    integer NOT NULL CHECK (spins_remaining >= 0),
  total_won          numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_won >= 0),
  status             text NOT NULL CHECK (status IN ('active','exhausted','expired','cancelled')),
  version            bigint NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL,
  CHECK (spins_remaining <= spins_granted),
  -- "exhausted" means exactly that; an active grant always has a spin left.
  CHECK ((status = 'exhausted') = (spins_remaining = 0) OR status IN ('expired','cancelled')),
  UNIQUE (campaign_id, operator_player_id)
);
CREATE INDEX ix_player_campaigns_player ON player_campaigns (operator_id, operator_player_id, status);
