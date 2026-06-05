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
  force_multiplier_value?: number;
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
  [key: string]: unknown;
}

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
