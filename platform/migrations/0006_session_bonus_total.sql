-- 0006_session_bonus_total.sql — carry the feature round's running win between spins.
--
-- The 20,000x max-win cap covers a whole feature round (trigger spin + every free
-- spin). Each RGS spin rebuilds the engine from the session, so the running total
-- must live on the session; without it every free spin was capped on its own.
-- Existing sessions start from 0 (the value every spin used before this column).

ALTER TABLE player_sessions ADD COLUMN bonus_round_win numeric(14,2) NOT NULL DEFAULT 0;
