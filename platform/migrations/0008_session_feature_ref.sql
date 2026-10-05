-- 0008_session_feature_ref.sql — bonus grouping key on the feature lock.
--
-- locked_feature_ref = round_ref of the round that triggered the engine's free-spins
-- feature. Every feature spin's wallet webhook carries it as featureRef so the casino
-- can group a bonus (trigger + free spins). Part of the lock: set with it, cleared
-- with it. Sessions locked before this column read back NULL; the RGS fills it the
-- next time it rebuilds a lock, and their feature spins are sent without featureRef.

ALTER TABLE player_sessions ADD COLUMN locked_feature_ref text;

ALTER TABLE player_sessions ADD CONSTRAINT player_sessions_feature_ref_check CHECK (
  locked_feature_ref IS NULL OR locked_bet IS NOT NULL
);
