-- 0009_operator_regulatory.sql — per-operator jurisdiction profile.
--
-- regulatory = the RegulatoryProfile the RGS enforces for this operator's players
-- (src/modules/regulatory/regulatory.ts): minimum time between rounds, reality-check
-- interval, autoplay / turbo / feature-buy switches, and the jurisdiction label.
-- NULL = the DEFAULT profile (no limits), which is what every operator created
-- before this column reads back as.

ALTER TABLE operators ADD COLUMN regulatory jsonb;
