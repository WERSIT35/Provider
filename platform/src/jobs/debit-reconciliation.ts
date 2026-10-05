import type { FastifyBaseLogger } from "fastify";
import type { DebitReconciler } from "../modules/wallet/debit-reconciler";
import type { SessionService } from "../modules/session/session.service";
import type { Persistence } from "../persistence/persistence";

/**
 * Background retry of queued debit reversals (DebitReconciler): a debit whose outcome
 * stayed unknown was voided, and its rollback could not reach the casino at the time.
 * Each sweep re-sends every queued reversal under its original rollback key, so the
 * casino refunds at most once however many sweeps it takes.
 *
 * Like the campaign-expiry job it runs outside an HTTP request, so it flushes its own
 * write-through batch.
 */
export interface DebitReconciliationJob {
  /** Run one sweep now; resolves with how many reversals the casino acknowledged. */
  runOnce(): Promise<number>;
  stop(): void;
}

export function startDebitReconciliation(deps: {
  debits: DebitReconciler;
  sessions: SessionService;
  persistence: Persistence;
  logger: FastifyBaseLogger;
  intervalMs: number;
}): DebitReconciliationJob {
  let running = false;

  const runOnce = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const { reversed, pending } = await deps.debits.sweep((tx) => deps.sessions.tryGet(tx.session_id)?.operator_player_id);
      if (reversed > 0) {
        await deps.persistence.flush();
        deps.logger.info({ reversed, pending }, "debit_reversals_acknowledged");
      } else if (pending > 0) {
        deps.logger.warn({ pending }, "debit_reversals_pending");
      }
      return reversed;
    } catch (err) {
      deps.logger.error({ err }, "debit_reconciliation_failed");
      return 0;
    } finally {
      running = false;
    }
  };

  // Sweep at start-up (reversals queued before a restart), then on the interval.
  void runOnce();
  const timer = deps.intervalMs > 0 ? setInterval(() => void runOnce(), deps.intervalMs) : null;
  timer?.unref();

  return {
    runOnce,
    stop: () => {
      if (timer) clearInterval(timer);
    }
  };
}
