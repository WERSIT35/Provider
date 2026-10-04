-- 0007_rules_hash.sql — record which rules payload resolved each round.
--
-- Scalers, paytable, scatter/feature parameters live in the rules file, so a seed
-- reproduces its outcome only under the same engine version (0005) AND the same rules.
-- rules_hash = SHA-256 of the canonical (key-order-independent) rules JSON
-- (EngineService.rulesHash()). rounds is append-only; ADD COLUMN with no default does
-- not touch existing rows, which read back NULL and are left off the hydrated object
-- (TableSpec.omitNull) so they keep the payload they were hash-chained with.

ALTER TABLE rounds ADD COLUMN rules_hash text;
