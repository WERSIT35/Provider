-- 0014_history_indexes.sql — indexes for reading history from Postgres (Phase 2).
--
-- With bounded memory the platform keeps only a window of each ledger in RAM and reads
-- the rest from here (src/modules/history/history.ts, src/persistence/hydrate.ts):
--   - boot loads the newest window by seq and each chain's tip;
--   - the integrity sweep streams each ledger in seq order, page by page;
--   - reports filter rounds by date range;
--   - boot finds the open queue items (unknown debits, failed credits);
--   - boot finds the sessions a token can still reach.

CREATE INDEX IF NOT EXISTS ix_rounds_seq ON rounds (seq);
CREATE INDEX IF NOT EXISTS ix_audit_records_seq ON audit_records (seq);
CREATE INDEX IF NOT EXISTS ix_wallet_transactions_seq ON wallet_transactions (seq);
CREATE INDEX IF NOT EXISTS ix_rounds_created ON rounds (created_at);
CREATE INDEX IF NOT EXISTS ix_tx_open_queue ON wallet_transactions (round_ref) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS ix_sessions_created ON player_sessions (created_at);
CREATE INDEX IF NOT EXISTS ix_sessions_in_feature ON player_sessions (id) WHERE free_spins_left > 0;
