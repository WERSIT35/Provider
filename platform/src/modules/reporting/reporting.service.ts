import type { RoundRepository, RoundRecord } from "../ledger/ledger.types";
import { BET_TX_TYPES, WIN_TX_TYPES, type InMemoryTransactionStore, type TxRecord } from "../wallet/transaction-store";
import type { EngineService } from "../engine/engine.service";
import type { InMemoryRoundAdjustmentStore } from "../rounds/round-adjustment.store";

/** Reporting + reconciliation over the immutable ledger (plan §10). All queries are
 * tenant-scoped when an operator_id is supplied. */

export interface DateRange {
  from?: string;
  to?: string;
}

export interface RoundsSummary {
  rounds: number;
  total_bet: number;
  total_win: number;
  ggr: number; // bet - win (gross gaming revenue)
  hold_percent: number; // ggr / bet * 100
}

export interface RtpReport {
  rounds: number;
  total_bet: number;
  total_win: number;
  actual_rtp_percent: number;
}

export interface GgrByDay {
  date: string;
  rounds: number;
  total_bet: number;
  total_win: number;
  ggr: number;
}

export interface Reconciliation {
  ok: boolean;
  rounds_total_bet: number;
  rounds_total_win: number;
  tx_debits: number;
  tx_credits: number;
  tx_rollbacks: number;
  bet_vs_debit_diff: number;
  win_vs_credit_diff: number;
}

/** One player's activity over a period (Operator Portal "Player Reports"). */
export interface PlayerReportRow {
  operator_id: string;
  operator_player_id: string;
  rounds: number;
  free_spin_rounds: number;
  total_bet: number; // turnover (bet actually charged; free spins charge 0)
  total_win: number;
  ggr: number; // bet - win, from the operator's point of view
  rtp_percent: number; // win / bet * 100 (0 when no turnover)
  biggest_win: number;
  first_seen: string;
  last_seen: string;
}

export const PLAYER_REPORT_SORTS = ["total_bet", "total_win", "ggr", "rounds", "rtp_percent", "last_seen"] as const;
export type PlayerReportSort = (typeof PLAYER_REPORT_SORTS)[number];

export interface PlayerReportQuery extends DateRange {
  game_id?: string;
  sort?: PlayerReportSort;
  limit?: number;
}

export interface PlayerReport {
  players: PlayerReportRow[];
  count: number; // rows returned (after limit)
  total_players: number; // matching players before limit
}

export interface PlayerSummary extends PlayerReportRow {
  voided_rounds: number;
  games_played: number;
}

function inRange(iso: string, range: DateRange): boolean {
  if (range.from && iso < range.from) return false;
  if (range.to && iso > range.to) return false;
  return true;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function emptyPlayerRow(r: RoundRecord): PlayerReportRow {
  return {
    operator_id: r.operator_id,
    operator_player_id: r.operator_player_id,
    rounds: 0,
    free_spin_rounds: 0,
    total_bet: 0,
    total_win: 0,
    ggr: 0,
    rtp_percent: 0,
    biggest_win: 0,
    first_seen: r.created_at,
    last_seen: r.created_at
  };
}

function addRound(row: PlayerReportRow, r: RoundRecord): void {
  row.rounds += 1;
  if (r.is_free_spin) row.free_spin_rounds += 1;
  row.total_bet = round2(row.total_bet + r.bet_charged);
  row.total_win = round2(row.total_win + r.total_win);
  if (r.total_win > row.biggest_win) row.biggest_win = r.total_win;
  if (r.created_at < row.first_seen) row.first_seen = r.created_at;
  if (r.created_at > row.last_seen) row.last_seen = r.created_at;
}

function finishPlayerRow(row: PlayerReportRow): PlayerReportRow {
  const ggr = round2(row.total_bet - row.total_win);
  const rtp_percent = row.total_bet > 0 ? round2((row.total_win / row.total_bet) * 100) : 0;
  return { ...row, ggr, rtp_percent };
}

export class ReportingService {
  constructor(
    private readonly rounds: RoundRepository,
    private readonly transactions: InMemoryTransactionStore,
    private readonly engine: EngineService,
    private readonly adjustments: InMemoryRoundAdjustmentStore
  ) {}

  listRounds(operatorId?: string, range: DateRange = {}): RoundRecord[] {
    return this.rounds
      .list(operatorId ? { operator_id: operatorId } : {})
      .filter((r) => inRange(r.created_at, range));
  }

  /** Rounds for a single player (support / dispute lookup). Newest first. */
  listRoundsByPlayer(operatorId: string, operatorPlayerId: string): RoundRecord[] {
    return this.rounds
      .list({ operator_id: operatorId, operator_player_id: operatorPlayerId })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** Full money-movement timeline for one round (the "why wasn't the player paid?" view). */
  transactionsForRound(roundRef: string): TxRecord[] {
    return this.transactions.list({ round_ref: roundRef }).sort((a, b) => a.seq - b.seq);
  }

  /** Financial totals must exclude voided rounds (their money was reversed). */
  private financialRounds(operatorId?: string, range: DateRange = {}): RoundRecord[] {
    const voided = this.adjustments.voidedRoundRefs(operatorId);
    return this.listRounds(operatorId, range).filter((r) => !voided.has(r.round_ref));
  }

  roundsSummary(operatorId?: string, range: DateRange = {}): RoundsSummary {
    const list = this.financialRounds(operatorId, range);
    const total_bet = round2(list.reduce((s, r) => s + r.bet_charged, 0));
    const total_win = round2(list.reduce((s, r) => s + r.total_win, 0));
    const ggr = round2(total_bet - total_win);
    return {
      rounds: list.length,
      total_bet,
      total_win,
      ggr,
      hold_percent: total_bet > 0 ? round2((ggr / total_bet) * 100) : 0
    };
  }

  rtpReport(operatorId?: string, range: DateRange = {}): RtpReport {
    const s = this.roundsSummary(operatorId, range);
    return {
      rounds: s.rounds,
      total_bet: s.total_bet,
      total_win: s.total_win,
      actual_rtp_percent: s.total_bet > 0 ? round2((s.total_win / s.total_bet) * 100) : 0
    };
  }

  ggrByDay(operatorId?: string, range: DateRange = {}): GgrByDay[] {
    const buckets = new Map<string, GgrByDay>();
    for (const r of this.financialRounds(operatorId, range)) {
      const date = r.created_at.slice(0, 10);
      const b = buckets.get(date) ?? { date, rounds: 0, total_bet: 0, total_win: 0, ggr: 0 };
      b.rounds += 1;
      b.total_bet = round2(b.total_bet + r.bet_charged);
      b.total_win = round2(b.total_win + r.total_win);
      b.ggr = round2(b.total_bet - b.total_win);
      buckets.set(date, b);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Per-player turnover / wins / GGR / RTP over a period, voided rounds excluded.
   * Provider scope (no operatorId) groups by operator + player, since player ids
   * are only unique within one operator.
   */
  playerReport(operatorId?: string, query: PlayerReportQuery = {}): PlayerReport {
    const rows = new Map<string, PlayerReportRow>();
    for (const r of this.financialRounds(operatorId, query)) {
      if (query.game_id && r.game_id !== query.game_id) continue;
      const key = r.operator_id + "\u0000" + r.operator_player_id;
      const row = rows.get(key) ?? emptyPlayerRow(r);
      addRound(row, r);
      rows.set(key, row);
    }
    const sort = query.sort ?? "total_bet";
    const sorted = Array.from(rows.values())
      .map(finishPlayerRow)
      .sort((a, b) => {
        const d = sort === "last_seen" ? b.last_seen.localeCompare(a.last_seen) : b[sort] - a[sort];
        return d !== 0 ? d : a.operator_player_id.localeCompare(b.operator_player_id);
      });
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 1000);
    const players = sorted.slice(0, limit);
    return { players, count: players.length, total_players: sorted.length };
  }

  /** Lifetime summary for one player (support view header). Null when the player has no rounds. */
  playerSummary(operatorId: string, operatorPlayerId: string): PlayerSummary | null {
    const all = this.rounds.list({ operator_id: operatorId, operator_player_id: operatorPlayerId });
    if (!all.length) return null;
    const voided = this.adjustments.voidedRoundRefs(operatorId);
    const row = emptyPlayerRow(all[0]);
    let voidedCount = 0;
    for (const r of all) {
      if (voided.has(r.round_ref)) voidedCount += 1;
      else addRound(row, r);
    }
    // "Seen" is activity, so voided rounds count (a fully-voided player still has one).
    row.first_seen = all.reduce((m, r) => (r.created_at < m ? r.created_at : m), all[0].created_at);
    row.last_seen = all.reduce((m, r) => (r.created_at > m ? r.created_at : m), all[0].created_at);
    return {
      ...finishPlayerRow(row),
      voided_rounds: voidedCount,
      games_played: new Set(all.map((r) => r.game_id)).size
    };
  }

  failedSettlements(operatorId?: string): TxRecord[] {
    return this.transactions.listFailedSettlements(operatorId);
  }

  /**
   * Reconcile the round ledger against the money ledger: total bet should equal
   * confirmed debits (minus rollbacks), and total win should equal confirmed credits.
   * Any drift is flagged for an operations incident (plan §10).
   */
  reconcile(operatorId?: string, range: DateRange = {}): Reconciliation {
    // Voided rounds are excluded: their bet was refunded and any win clawed back, so
    // they must not count on the round side either (the money side nets to zero too).
    const rounds = this.financialRounds(operatorId, range);
    const rounds_total_bet = round2(rounds.reduce((s, r) => s + r.bet_charged, 0));
    const rounds_total_win = round2(rounds.reduce((s, r) => s + r.total_win, 0));

    const txs = this.transactions.list(operatorId ? { operator_id: operatorId } : {});
    const sum = (types: ReadonlySet<TxRecord["type"]> | TxRecord["type"], status: TxRecord["status"]): number =>
      round2(
        txs
          .filter((t) => (typeof types === "string" ? t.type === types : types.has(t.type)) && t.status === status)
          .reduce((s, t) => s + t.amount, 0)
      );

    // Free rounds: FREE_ROUND_BET is always 0.00 and FREE_ROUND_WIN is a paid win,
    // so they reconcile exactly like DEBIT / CREDIT against the round ledger.
    const tx_debits = sum(BET_TX_TYPES, "confirmed");
    const tx_credits_gross = sum(WIN_TX_TYPES, "confirmed");
    const tx_rollbacks = sum("ROLLBACK", "rolled_back");
    // Void clawbacks are compensating debits that reverse a previously-paid win.
    const tx_clawbacks = sum("ADJUSTMENT", "confirmed");
    const tx_credits = round2(tx_credits_gross - tx_clawbacks);

    const bet_vs_debit_diff = round2(rounds_total_bet - (tx_debits - tx_rollbacks));
    const win_vs_credit_diff = round2(rounds_total_win - tx_credits);
    return {
      // Credits may legitimately lag (failed-settlement queue), so reconciliation is
      // "ok" when bets match debits and credits never EXCEED wins.
      ok: Math.abs(bet_vs_debit_diff) < 0.01 && win_vs_credit_diff > -0.01,
      rounds_total_bet,
      rounds_total_win,
      tx_debits,
      tx_credits,
      tx_rollbacks,
      bet_vs_debit_diff,
      win_vs_credit_diff
    };
  }
}
