-- 0010_wallet_tx_trace.sql — W3C trace id on every money move.
--
-- trace_id = the trace (src/lib/trace-context.ts) of the request that made the move:
-- the game client's round trace when it sent one, else the RGS's own. The same id is
-- sent to the casino as `traceparent` on the wallet webhook, so one player action can
-- be followed from the client through both ledgers. NULL on rows written before this.

ALTER TABLE wallet_transactions ADD COLUMN trace_id text;
CREATE INDEX IF NOT EXISTS ix_wallet_tx_trace ON wallet_transactions (trace_id) WHERE trace_id IS NOT NULL;
