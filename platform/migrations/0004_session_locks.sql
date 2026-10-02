-- 0004_session_locks.sql — bonus-feature lock on player sessions.
--
-- When a round triggers the engine's free-spins feature, the session snapshots the
-- terms it was played at and every feature spin plays exactly those terms; the
-- client's requested bet/ante are ignored until the feature ends (locks → NULL).
-- Without it a player could trigger at 1.00 and play the 0-cost feature at 500.00,
-- or switch ante on mid-feature to double the scatter rate for free.
-- locked_campaign_id/locked_grant_id: the feature was triggered by an operator free
-- round, so its wins are paid as FREE_ROUND_WIN against that campaign.

ALTER TABLE player_sessions ADD COLUMN locked_bet         numeric(14,2);
ALTER TABLE player_sessions ADD COLUMN locked_currency    text;
ALTER TABLE player_sessions ADD COLUMN locked_ante        boolean;
ALTER TABLE player_sessions ADD COLUMN locked_campaign_id text;
ALTER TABLE player_sessions ADD COLUMN locked_grant_id    text;

-- A lock is all-or-nothing, and outside a feature there is no lock.
ALTER TABLE player_sessions ADD CONSTRAINT player_sessions_lock_shape_check CHECK (
  ((locked_bet IS NULL) = (locked_currency IS NULL)) AND
  ((locked_bet IS NULL) = (locked_ante IS NULL)) AND
  ((locked_campaign_id IS NULL) = (locked_grant_id IS NULL)) AND
  (locked_campaign_id IS NULL OR locked_bet IS NOT NULL) AND
  (locked_bet IS NULL OR (locked_bet > 0 AND free_spins_left > 0))
);

-- Deliberately NO "in a feature ⇒ locked" constraint: sessions already mid-feature
-- when this ships have no lock, and the RGS rebuilds it from the session's last
-- recorded round on their next spin. A NOT VALID check would still reject any other
-- UPDATE of such a row (e.g. closing the session) and wedge the write-through flush.
