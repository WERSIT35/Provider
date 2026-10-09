-- 0011_ledger_trace.sql — W3C trace id on the round and audit ledgers.
--
-- Same trace as wallet_transactions.trace_id (0010): the trace of the request that
-- wrote the row (src/lib/trace-context.ts), so a disputed round links to its money
-- moves, its audit entry, the request logs and the casino's webhook rows by one id.
--
-- Both ledgers are hash-chained and the payload hash covers every key the app wrote.
-- trace_id is written ONLY when there is a trace (persistence.ts TABLES omitNull):
-- rows recorded before this migration, and rows written outside a request (background
-- jobs), stay NULL here and are hydrated without the key, so their hashes still match.

ALTER TABLE rounds ADD COLUMN trace_id text;
ALTER TABLE audit_records ADD COLUMN trace_id text;

CREATE INDEX IF NOT EXISTS ix_rounds_trace ON rounds (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_audit_records_trace ON audit_records (trace_id) WHERE trace_id IS NOT NULL;
