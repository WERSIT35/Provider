import type { FastifyBaseLogger } from "fastify";
import type { RoundIntent, RoundIntentStore } from "../modules/rounds/round-intents";
import type { RoundLedgerService } from "../modules/ledger/round-ledger.service";
import type { InMemoryTransactionStore, TxRecord } from "../modules/wallet/transaction-store";
import { DEBIT_OUTCOME_UNKNOWN } from "../modules/wallet/transaction-store";
import type { DebitReconciler } from "../modules/wallet/debit-reconciler";
import type { WalletAdapter, RoundType } from "../modules/wallet/wallet.types";
import type { Persistence } from "../persistence/persistence";

/**
 * Finishes or unwinds rounds a crash (or a database outage) left between the casino
 * and our ledger, using their write-ahead intents (modules/rounds/round-intents.ts):
 *
 *  - OPEN, round never committed → the stake may be at the casino with no round here:
 *    void it and reverse the debit by its idempotency key (the casino refunds it, or
 *    tombstones the key if it never got the debit). Retried until acknowledged.
 *  - COMMITTED, win not yet credited → credit it under the round's ORIGINAL credit key,
 *    so a credit the casino already applied is replayed, never paid twice.
 *
 * Runs at start-up and on the reconciliation interval. A round still in flight in this
 * process, or touched less than `minAgeMs` ago, is left alone. It acts only after its
 * own flush succeeds: crediting a win whose round is not durable could pay a round
 * that a later crash would unwind.
 */
export interface RecoveryResult {
  reversed: number;
  credited: number;
  pending: number;
}

export interface RoundRecoveryDeps {
  intents: RoundIntentStore;
  ledger: RoundLedgerService;
  transactions: InMemoryTransactionStore;
  debits: DebitReconciler;
  wallet: WalletAdapter;
  persistence: Persistence;
  isInFlight: (key: string) => boolean;
  logger: FastifyBaseLogger;
  /** Leave intents younger than this alone (a request may still be finishing them). */
  minAgeMs: number;
}

export async function recoverRounds(deps: RoundRecoveryDeps, now = Date.now()): Promise<RecoveryResult> {
  const result: RecoveryResult = { reversed: 0, credited: 0, pending: 0 };
  // Everything queued so far must be durable before acting on it.
  await deps.persistence.flush();

  for (const intent of deps.intents.list()) {
    const key = intent.idempotency_key;
    if (deps.isInFlight(key) || now - Date.parse(intent.updated_at) < deps.minAgeMs) {
      result.pending += 1;
      continue;
    }
    const round = deps.ledger.getRound(intent.round_ref);
    if (intent.status === "open" && !round) {
      if (await reverseStake(deps, intent)) {
        deps.intents.close(key, "voided");
        result.reversed += 1;
      } else result.pending += 1;
      continue;
    }
    // Committed (or open but its round is in: the commit landed, the status didn't).
    const win = intent.win_amount ?? Number(round?.total_win ?? 0);
    if (!(win > 0) || deps.transactions.getByKey(`${key}:credit`)) {
      // Nothing to pay, or the credit is recorded (a failed one is in the settlement queue).
      deps.intents.close(key, "settled");
      continue;
    }
    if (await creditWin(deps, intent, win)) {
      deps.intents.close(key, "settled");
      result.credited += 1;
    } else result.pending += 1;
  }

  await deps.persistence.flush();
  return result;
}

async function reverseStake(deps: RoundRecoveryDeps, intent: RoundIntent): Promise<boolean> {
  if (!intent.debit_type) return true; // no stake was ever asked for
  const debitKey = `${intent.idempotency_key}:debit`;
  let debit: TxRecord | null = deps.transactions.getByKey(debitKey);
  if (!debit) {
    // We never learnt what the casino did: record the debit as unknown (the same row
    // the in-line reconciler writes), which also queues it for the reversal sweep.
    debit = deps.transactions.record({
      operator_id: intent.operator_id,
      session_id: intent.session_id,
      round_ref: intent.round_ref,
      type: intent.debit_type,
      amount: intent.debit_amount,
      currency: intent.currency,
      idempotency_key: debitKey,
      status: "failed",
      error_code: DEBIT_OUTCOME_UNKNOWN,
      ...(intent.campaign_id ? { campaign_id: intent.campaign_id } : {})
    });
  }
  return deps.debits.reverse(debit, intent.operator_player_id);
}

async function creditWin(deps: RoundRecoveryDeps, intent: RoundIntent, win: number): Promise<boolean> {
  const creditKey = `${intent.idempotency_key}:credit`;
  const freeRoundTag = intent.credit_type === "FREE_ROUND_WIN" && intent.campaign_id ? { txType: "FREE_ROUND_WIN" as const, campaignId: intent.campaign_id } : {};
  try {
    const credit = await deps.wallet.credit(
      { operatorId: intent.operator_id },
      {
        idempotencyKey: creditKey,
        roundRef: intent.round_ref,
        operatorPlayerId: intent.operator_player_id,
        amount: win,
        currency: intent.currency,
        ...(intent.game_code ? { gameCode: intent.game_code } : {}),
        ...(intent.round_type ? { roundType: intent.round_type as RoundType } : {}),
        ...(intent.feature_ref ? { featureRef: intent.feature_ref } : {}),
        ...freeRoundTag
      }
    );
    deps.transactions.record({
      operator_id: intent.operator_id,
      session_id: intent.session_id,
      round_ref: intent.round_ref,
      type: intent.credit_type ?? "CREDIT",
      amount: win,
      currency: intent.currency,
      idempotency_key: creditKey,
      operator_tx_ref: credit.operatorTxRef,
      status: "confirmed",
      ...(intent.campaign_id && intent.credit_type === "FREE_ROUND_WIN" ? { campaign_id: intent.campaign_id } : {})
    });
    return true;
  } catch (err) {
    deps.logger.warn({ err, round_ref: intent.round_ref }, "round_recovery_credit_failed");
    return false; // retried on the next sweep, same key
  }
}

export interface RoundRecoveryJob {
  runOnce(): Promise<RecoveryResult>;
  stop(): void;
}

/** Recovery at start-up (minAgeMs 0: nothing of a dead process is in flight), then on the interval. */
export function startRoundRecovery(deps: Omit<RoundRecoveryDeps, "minAgeMs"> & { intervalMs: number; minAgeMs?: number }): RoundRecoveryJob {
  let running = false;
  let first = true;
  const runOnce = async (): Promise<RecoveryResult> => {
    if (running) return { reversed: 0, credited: 0, pending: 0 };
    running = true;
    try {
      const r = await recoverRounds({ ...deps, minAgeMs: first ? 0 : deps.minAgeMs ?? 30_000 });
      first = false;
      if (r.reversed || r.credited) deps.logger.warn(r, "round_recovery_completed");
      else if (r.pending) deps.logger.info(r, "round_recovery_pending");
      return r;
    } catch (err) {
      deps.logger.error({ err }, "round_recovery_failed");
      return { reversed: 0, credited: 0, pending: deps.intents.size() };
    } finally {
      running = false;
    }
  };
  void runOnce();
  const timer = deps.intervalMs > 0 ? setInterval(() => void runOnce(), deps.intervalMs) : null;
  timer?.unref();
  return { runOnce, stop: () => timer && clearInterval(timer) };
}
