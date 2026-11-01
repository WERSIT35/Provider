import type { RoundRecord } from "../ledger/ledger.types";
import type { Tournament, TournamentMetric } from "./promotions";

/**
 * A tournament's leaderboard, read from the round ledger (never kept per spin, so the
 * spin path is untouched). A round counts when it belongs to the tournament's operator,
 * was played in [starts_at, ends_at), in one of its games and its currency, at a stake
 * of at least min_bet, is not an operator free round and is not voided.
 *
 *   max_multiplier — the player's best round: win ÷ stake (4 decimals);
 *   total_win      — the sum of the player's wins;
 *   turnover       — the sum of what the player was charged.
 *
 * Ties: whoever got there first (best round: its time; sums: the last counted round),
 * then the player id. Only a positive score ranks.
 */
export interface BoardRow {
  rank: number;
  operator_player_id: string;
  score: number;
  rounds: number;
  achieved_at: string;
}

export interface BoardRound {
  operator_player_id: string;
  created_at: string;
  bet_amount: number;
  bet_charged: number;
  total_win: number;
}

const r4 = (n: number): number => Number(n.toFixed(4));

/** Does a round count for the tournament? (in-memory form; PgHistory has the SQL twin) */
export function countsFor(t: Pick<Tournament, "operator_id" | "starts_at" | "ends_at" | "min_bet" | "currency" | "game_codes">, r: RoundRecord, voided: Set<string>, ctx: { currency: string; game_code: string }): boolean {
  return r.operator_id === t.operator_id && r.created_at >= t.starts_at && r.created_at < t.ends_at && !r.campaign_id &&
    r.bet_amount >= t.min_bet && !voided.has(r.round_ref) && ctx.currency === t.currency && t.game_codes.includes(ctx.game_code);
}

export function rankBoard(metric: TournamentMetric, rounds: BoardRound[], limit: number): BoardRow[] {
  const per = new Map<string, { score: number; rounds: number; achieved_at: string }>();
  for (const r of rounds) {
    const cur = per.get(r.operator_player_id) ?? { score: 0, rounds: 0, achieved_at: r.created_at };
    cur.rounds += 1;
    if (metric === "max_multiplier") {
      const m = r.bet_amount > 0 ? r4(r.total_win / r.bet_amount) : 0;
      if (m > cur.score || (m === cur.score && cur.rounds === 1) || (m === cur.score && r.created_at < cur.achieved_at)) { cur.score = m; cur.achieved_at = r.created_at; }
    } else {
      cur.score = r4(cur.score + (metric === "total_win" ? r.total_win : r.bet_charged));
      if (r.created_at > cur.achieved_at) cur.achieved_at = r.created_at;
    }
    per.set(r.operator_player_id, cur);
  }
  return [...per]
    .filter(([, v]) => v.score > 0)
    .sort(([pa, a], [pb, b]) => b.score - a.score || a.achieved_at.localeCompare(b.achieved_at) || pa.localeCompare(pb))
    .slice(0, Math.max(0, limit))
    .map(([player, v], i) => ({ rank: i + 1, operator_player_id: player, score: v.score, rounds: v.rounds, achieved_at: v.achieved_at }));
}
