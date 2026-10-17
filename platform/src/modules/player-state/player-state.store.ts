import { NullPersistence, type Persistence } from "../../persistence/persistence";

/**
 * State a game keeps for a player across sessions (USES_PLAYER_STATE), e.g. Relic Forge's
 * Forge meter. One row per operator, player, game, currency and bet: a 1.00 GEL meter is
 * not a 5.00 GEL one, and not a 1.00 EUR one.
 *
 * A row is valid only under the rules it was built with (`rules_hash`): after a rules
 * change the stored state reads back as empty (the game's disclosed reset policy), and
 * the next round overwrites it. The state is opaque here; the engine owns its shape.
 */
export interface PlayerGameState {
  id: string;
  operator_id: string;
  operator_player_id: string;
  game_code: string;
  currency: string;
  bet_amount: number;
  state: unknown;
  rules_hash: string;
  /** Bumped on every write; the Postgres upsert never lets an older version win. */
  version: number;
  updated_at: string;
}

export interface PlayerStateKey {
  operator_id: string;
  operator_player_id: string;
  game_code: string;
  currency: string;
  bet_amount: number;
}

/** The row id (and lock key) for a player's state at one bet. */
export function playerStateId(k: PlayerStateKey): string {
  return [k.operator_id, k.operator_player_id, k.game_code, k.currency, Number(k.bet_amount).toFixed(2)].join("|");
}

export class PlayerStateStore {
  private readonly rows = new Map<string, PlayerGameState>();

  constructor(private readonly persistence: Persistence = NullPersistence) {}

  /** The stored state, or null when there is none or it was built under other rules. */
  get(key: PlayerStateKey, rulesHash: string): unknown {
    const row = this.rows.get(playerStateId(key));
    return row && row.rules_hash === rulesHash ? row.state : null;
  }

  /** Every bet's state for a player in one game and currency (for the client's resume). */
  byBet(key: Omit<PlayerStateKey, "bet_amount">, rulesHash: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.rows.values()) {
      if (
        row.operator_id === key.operator_id &&
        row.operator_player_id === key.operator_player_id &&
        row.game_code === key.game_code &&
        row.currency === key.currency &&
        row.rules_hash === rulesHash
      ) {
        out[Number(row.bet_amount).toFixed(2)] = row.state;
      }
    }
    return out;
  }

  set(key: PlayerStateKey, state: unknown, rulesHash: string): void {
    const id = playerStateId(key);
    const prev = this.rows.get(id);
    const row: PlayerGameState = {
      id,
      ...key,
      bet_amount: Number(key.bet_amount),
      state: state ?? null,
      rules_hash: rulesHash,
      version: (prev?.version ?? 0) + 1,
      updated_at: new Date().toISOString()
    };
    this.rows.set(id, row);
    this.persistence.save("player_game_state", row);
  }

  hydrate(rows: PlayerGameState[]): void {
    for (const r of rows) this.rows.set(r.id, { ...r, bet_amount: Number(r.bet_amount), version: Number(r.version) });
  }
}
