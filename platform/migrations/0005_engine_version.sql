-- 0005_engine_version.sql — record which engine version resolved each round.
--
-- A round's seed can only be replay-verified by the engine code that produced it,
-- so every round now carries the engine's ENGINE_VERSION (client/engine/spin-engine.js).
-- rounds is append-only (deny_mutation trigger). ADD COLUMN with no default does not
-- rewrite or UPDATE existing rows, so historical rounds read back NULL, and the app
-- leaves that NULL off the hydrated object (TableSpec.omitNull) so they keep the exact
-- payload they were hash-chained with.

ALTER TABLE rounds ADD COLUMN engine_version text;
