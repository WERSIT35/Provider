-- 0015_stateful_games.sql — state for games beyond Vault 20K (Relic Forge, docs/relic-forge).
--
-- player_sessions.feature_state: a stateful game's per-session state (relics, the pending
-- draft offer, carried Mult…), opaque to the platform, owned by the game's engine. NULL
-- for Vault 20K and for any session outside a feature.
--
-- player_game_state: state a game keeps for a player ACROSS sessions, one row per
-- operator, player, game, currency and bet (Relic Forge's Forge meter). rules_hash is the
-- rules the state was built under; under other rules it reads back empty (the game's
-- disclosed reset policy). Every write bumps `version`, and the write-through upsert only
-- applies a newer version, so a stale flush can never roll a meter back.

ALTER TABLE player_sessions ADD COLUMN feature_state jsonb;

CREATE TABLE player_game_state (
  id                 text PRIMARY KEY,
  operator_id        text NOT NULL,
  operator_player_id text NOT NULL,
  game_code          text NOT NULL,
  currency           text NOT NULL,
  bet_amount         numeric(14,2) NOT NULL,
  state              jsonb,
  rules_hash         text NOT NULL,
  version            bigint NOT NULL DEFAULT 1,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, operator_player_id, game_code, currency, bet_amount)
);

CREATE INDEX IF NOT EXISTS ix_player_game_state_player ON player_game_state (operator_id, operator_player_id, game_code);
