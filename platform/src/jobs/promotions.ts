import type { FastifyBaseLogger } from "fastify";
import type { InMemoryPromotionsRepository } from "../modules/promotions/promotions";
import type { PromoPayoutService } from "../modules/promotions/promo-payout";
import type { HistoryReads } from "../modules/history/history";
import type { Persistence } from "../persistence/persistence";

/**
 * Promotions job (start-up sweep + every `intervalMs`):
 *  1. closes tournaments whose window ended more than `graceMs` ago: ranks the board from
 *     the round ledger (after a flush, so every round played in the window is there)
 *     and records a prize per rank;
 *  2. pays every prize not yet paid (promo-payout.ts: fixed key per prize, retried).
 * Runs outside a request, so it flushes its own writes (like campaign-expiry.ts).
 */
export interface PromotionsJob {
  runOnce(): Promise<{ closed: number; paid: number; failed: number }>;
  stop(): void;
}

export const PROMO_CLOSE_GRACE_MS = 15_000;

export function startPromotionsJob(deps: {
  promotions: InMemoryPromotionsRepository;
  payouts: PromoPayoutService;
  history: HistoryReads;
  persistence: Persistence;
  logger: FastifyBaseLogger;
  intervalMs: number;
  graceMs?: number;
  now?: () => Date;
}): PromotionsJob {
  const now = deps.now ?? (() => new Date());
  const grace = deps.graceMs ?? PROMO_CLOSE_GRACE_MS;
  let current: Promise<{ closed: number; paid: number; failed: number }> | null = null;

  // One run at a time; a call during a run shares that run's result.
  const runOnce = () => (current ??= run().finally(() => { current = null; }));
  const run = async () => {
    try {
      const t = now();
      const cutoff = new Date(t.getTime() - grace).toISOString();
      let closed = 0;
      const due = deps.promotions.dueTournaments(cutoff);
      if (due.length) await deps.persistence.flush(); // rounds of the window are durable before SQL reads them
      for (const tour of due) {
        const board = await deps.history.tournamentBoard(tour, tour.prizes.length);
        const wins = deps.promotions.closeTournament(tour.id, board.map((b) => ({ operator_player_id: b.operator_player_id, score: b.score })), t.toISOString());
        closed += 1;
        deps.logger.info({ tournament_id: tour.id, winners: wins.length }, "tournament_closed");
      }
      if (closed) await deps.persistence.flush(); // winners are durable before any money moves
      const pay = deps.promotions.unpaidWins().length ? await deps.payouts.payPending() : { paid: 0, failed: 0 };
      if (pay.paid || pay.failed) {
        await deps.persistence.flush();
        deps.logger.info(pay, "promo_wins_paid");
      }
      return { closed, ...pay };
    } catch (err) {
      deps.logger.error({ err }, "promotions_job_failed");
      return { closed: 0, paid: 0, failed: 0 };
    }
  };

  void runOnce();
  const timer = deps.intervalMs > 0 ? setInterval(() => void runOnce(), deps.intervalMs) : null;
  timer?.unref();
  return { runOnce, stop: () => { if (timer) clearInterval(timer); } };
}
