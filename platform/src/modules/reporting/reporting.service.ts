import type { RoundRepository, RoundRecord } from "../ledger/ledger.types";
import type { InMemoryTransactionStore, TxRecord } from "../wallet/transaction-store";
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

function inRange(iso: string, range: DateRange): boolean {
  if (range.from && iso < range.from) return false;
  if (range.to && iso > range.to) return false;
  return true;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
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
    const sum = (type: TxRecord["type"], status: TxRecord["status"]): number =>
      round2(txs.filter((t) => t.type === type && t.status === status).reduce((s, t) => s + t.amount, 0));

    const tx_debits = sum("DEBIT", "confirmed");
    const tx_credits_gross = sum("CREDIT", "confirmed");
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
