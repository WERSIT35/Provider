/** Typed surface for the spin engine. The engine returns rich objects; we type
 * the fields the platform relies on and allow extra keys via index signatures. */

export interface CreateSessionInput {
  player_id?: string;
  currency?: string;
  locale?: string;
  game_id?: string;
}

export interface SessionInit {
  session_id: string;
  balance: number;
  allowed_bets: number[];
  currency: string;
  locale: string;
  game_id: string;
  slug: string;
  free_spins_left: number;
  [key: string]: unknown;
}

export interface SpinInput {
  bet_amount: number;
  ante_enabled?: boolean;
  spin_id?: string;
  /**
   * A player's pick from the offer the previous round left in the session's feature
   * state (Relic Forge's relic draft). Only an engine with SUPPORTS_CHOICE receives it;
   * the orchestrator checks it against EngineService.choiceOptions() before money moves.
   */
  choice?: number;
  // No force_multiplier_value: the engine's dev-only inputs are never part of an RGS
  // spin (engine.service.ts engineInput).
}

export interface WaysWin {
  symbol: string;
  count: number;
  payout: number;
  amount: number;
}

export interface Position {
  row: number;
  col: number;
}

export interface TumbleStep {
  matrix: string[][];
  multipliers: unknown[];
  ways_wins: WaysWin[];
  win_total: number;
  winning_positions: Position[];
}

export interface SpinResult {
  spin_id: string;
  is_free_spin: boolean;
  bet_amount: number;
  bet_charged: number;
  matrix: string[][];
  multipliers: unknown[];
  tumble_steps: TumbleStep[];
  ways_wins: WaysWin[];
  total_win: number;
  multiplier_applied: number;
  balance_after: number;
  free_spins_left: number;
  free_spins_awarded: number;
  /**
   * Stateful games only (USES_FEATURE_STATE): the session's feature state after this
   * round (null = none). Part of the hashed outcome, so it is replayed and audited.
   */
  feature_state?: unknown;
  /**
   * Stateful games only (USES_PLAYER_STATE): the state kept per player, game, currency
   * and bet across sessions (Relic Forge's Forge meter), after this round.
   */
  player_state?: unknown;
  [key: string]: unknown;
}

/** The fields every game's result carries, whatever else its payload holds. */
export type CoreSpinResult = Pick<
  SpinResult,
  "spin_id" | "is_free_spin" | "bet_amount" | "bet_charged" | "total_win" | "free_spins_left" | "free_spins_awarded" | "feature_state" | "player_state"
>;

export interface SimulateInput {
  steps: number;
  betAmount: number;
  anteEnabled?: boolean;
  bonusOnly?: boolean;
  gameId?: string;
}

export interface RtpProfile {
  game_id: string;
  slug?: string;
  theoretical_percent: number;
  [key: string]: unknown;
}
