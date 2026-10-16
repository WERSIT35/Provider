-- 0013_round_intents.sql — write-ahead record of every round that moves money.
--
-- A paid round touches two systems that cannot share a transaction: the casino's
-- wallet and our ledger. A crash between "the casino took the stake" and "the round is
-- committed here" used to leave a debit with no round (docs/perf-baseline.md, crash
-- test). So the round orchestrator (src/modules/rounds/round-intents.ts):
--
--   1. commits an intent row (status 'open') BEFORE asking the casino for the stake;
--   2. commits the round together with the intent moved to 'committed' BEFORE it
--      credits the win;
--   3. marks it 'settled' once the win is credited (or there is none).
--
-- On boot, an 'open' intent whose round never committed is voided and its debit is
-- reversed at the casino (by the debit's idempotency key, so a debit the casino never
-- applied is tombstoned instead). A 'committed' one is credited again under the SAME
-- idempotency key (the casino replays a credit it already applied).
--
-- Not a ledger: rows change status and settled rows may be pruned. The ledgers
-- (rounds, wallet_transactions, audit_records) stay append-only.

CREATE TABLE round_intents (
  idempotency_key     text PRIMARY KEY,
  round_ref           text NOT NULL,
  operator_id         text NOT NULL,
  session_id          text NOT NULL,
  operator_player_id  text NOT NULL,
  currency            text NOT NULL,
  debit_type          text CHECK (debit_type IN ('DEBIT', 'FREE_ROUND_BET')),
  debit_amount        numeric(14,2) NOT NULL DEFAULT 0,
  campaign_id         text,
  credit_type         text CHECK (credit_type IN ('CREDIT', 'FREE_ROUND_WIN')),
  win_amount          numeric(14,2),
  game_code           text,
  round_type          text,
  feature_ref         text,
  status              text NOT NULL CHECK (status IN ('open', 'committed', 'settled', 'voided')),
  version             integer NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);

-- Boot recovery reads only the unfinished ones.
CREATE INDEX ix_round_intents_unfinished ON round_intents (status) WHERE status IN ('open', 'committed');
