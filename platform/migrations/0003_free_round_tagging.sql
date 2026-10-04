-- 0003_free_round_tagging.sql — tag money movements and rounds funded by an
-- operator free-round campaign (see 0002_campaigns.sql).
--
-- Both tables are append-only (deny_mutation trigger). ADD COLUMN with no default
-- does not rewrite or UPDATE existing rows, so the triggers are not involved and
-- historical rows simply read back NULL. The app leaves those NULLs OFF the
-- hydrated objects (TableSpec.omitNull) so pre-existing rounds keep the exact
-- payload they were hash-chained with.

-- ── Money ledger ───────────────────────────────────────────────────────────────
ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('DEBIT','CREDIT','ROLLBACK','ADJUSTMENT','FREE_ROUND_BET','FREE_ROUND_WIN'));

ALTER TABLE wallet_transactions ADD COLUMN campaign_id text;

-- A free-round row always names its campaign, and a free-round bet never moves money.
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_free_round_campaign_check
  CHECK (type NOT IN ('FREE_ROUND_BET','FREE_ROUND_WIN') OR campaign_id IS NOT NULL);
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_free_round_bet_zero_check
  CHECK (type <> 'FREE_ROUND_BET' OR amount = 0);

CREATE INDEX ix_tx_campaign ON wallet_transactions (campaign_id) WHERE campaign_id IS NOT NULL;

-- ── Round ledger ───────────────────────────────────────────────────────────────
ALTER TABLE rounds ADD COLUMN campaign_id text;
ALTER TABLE rounds ADD COLUMN grant_id    text;
ALTER TABLE rounds ADD CONSTRAINT rounds_free_round_pair_check
  CHECK ((campaign_id IS NULL) = (grant_id IS NULL));

CREATE INDEX ix_rounds_campaign ON rounds (campaign_id) WHERE campaign_id IS NOT NULL;
