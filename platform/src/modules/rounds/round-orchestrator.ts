import type { EngineService, SessionSnapshot } from "../engine/engine.service";
import type { SpinInput, SpinResult } from "../engine/engine.types";
import type { AuthoritativeRound } from "../rng/authoritative-resolver";
import type { SessionService, Session } from "../session/session.service";
import type { ManagementService } from "../management/management.service";
import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { InMemoryTransactionStore } from "../wallet/transaction-store";
import { type WalletAdapter, type Money, WalletDeclinedError } from "../wallet/wallet.types";

export interface ResolverPort {
  resolve(snapshot: SessionSnapshot, input: SpinInput): AuthoritativeRound;
}

export interface SpinRequest {
  bet_amount: number;
  ante_enabled?: boolean;
  idempotency_key: string;
}

export type Settlement = "settled" | "credit_pending";

export interface SpinOutcome {
  round_ref: string;
  outcome_hash: string;
  bet_charged: number;
  total_win: number;
  balance: Money;
  free_spins_left: number;
  settlement: Settlement;
  idempotent_replay: boolean;
  result: SpinResult;
}

/**
 * The server-authoritative round lifecycle (plan §5). Ties together session
 * validation, the operator wallet, the seeded RNG resolver, and the immutable
 * ledger:
 *
 *   validate → debit → resolve → record round → credit → settle
 *
 * Every money move is idempotent (keyed by the request's idempotency key), so
 * retries never double-charge. A failure AFTER a confirmed debit but BEFORE a
 * recorded outcome triggers a wallet rollback; a credit failure keeps the round
 * recorded and flags settlement for the failed-settlement queue (never silently
 * dropping a win).
 */
export class RoundOrchestrator {
  private readonly idem = new Map<string, SpinOutcome>();

  constructor(
    private readonly engine: EngineService,
    private readonly resolver: ResolverPort,
    private readonly sessions: SessionService,
    private readonly mgmt: ManagementService,
    private readonly wallet: WalletAdapter,
    private readonly ledger: RoundLedgerService,
    private readonly transactions: InMemoryTransactionStore
  ) {}

  async spin(sessionId: string, req: SpinRequest): Promise<SpinOutcome> {
    // App-level idempotency: a repeated key returns the stored outcome verbatim.
    const cached = this.idem.get(req.idempotency_key);
    if (cached) return { ...cached, idempotent_replay: true };

    const session = this.sessions.get(sessionId);
    this.mgmt.assertOperatorActive(session.operator_id);
    if (!session.allowed_bets.includes(req.bet_amount)) throw new Error("INVALID_BET");

    const ctx = { operatorId: session.operator_id };
    const isFreeSpin = session.free_spins_left > 0;
    const charge = isFreeSpin
      ? 0
      : req.ante_enabled
        ? Number((req.bet_amount * this.engine.anteMultiplier()).toFixed(2))
        : req.bet_amount;
    const roundRef = `r_${req.idempotency_key}`;

    // 1) DEBIT (skipped on free spins). Decline aborts the round entirely.
    let debitTxRef: string | null = null;
    if (charge > 0) {
      const debit = await this.wallet.debit(ctx, {
        idempotencyKey: `${req.idempotency_key}:debit`,
        roundRef,
        operatorPlayerId: session.operator_player_id,
        amount: charge,
        currency: session.currency
      });
      debitTxRef = debit.operatorTxRef;
      this.transactions.record({
        operator_id: session.operator_id,
        session_id: session.id,
        round_ref: roundRef,
        type: "DEBIT",
        amount: charge,
        currency: session.currency,
        idempotency_key: `${req.idempotency_key}:debit`,
        operator_tx_ref: debitTxRef,
        status: "confirmed"
      });
    }

    // 2) RESOLVE (server-authoritative, seeded). Failure after debit → rollback.
    let resolved: AuthoritativeRound;
    try {
      resolved = this.resolver.resolve(this.snapshotFor(session), {
        bet_amount: req.bet_amount,
        ante_enabled: req.ante_enabled
      });
    } catch (err) {
      if (debitTxRef) {
        await this.wallet.rollback(ctx, {
          idempotencyKey: `${req.idempotency_key}:rollback`,
          originalOperatorTxRef: debitTxRef,
          roundRef
        });
        this.transactions.record({
          operator_id: session.operator_id,
          session_id: session.id,
          round_ref: roundRef,
          type: "ROLLBACK",
          amount: charge,
          currency: session.currency,
          idempotency_key: `${req.idempotency_key}:rollback`,
          status: "rolled_back"
        });
      }
      throw err;
    }

    // 3) RECORD the immutable round (legal system of record).
    this.ledger.recordResolvedRound(
      {
        round_ref: roundRef,
        session_id: session.id,
        operator_id: session.operator_id,
        game_id: session.game_id,
        math_config_id: session.math_config_id,
        bet_amount: req.bet_amount,
        is_free_spin: isFreeSpin,
        ante_enabled: Boolean(req.ante_enabled)
      },
      resolved
    );

    // 4) CREDIT the win. Failure keeps the round and flags settlement.
    const win = Number(resolved.result.total_win ?? 0);
    let settlement: Settlement = "settled";
    if (win > 0) {
      const creditKey = `${req.idempotency_key}:credit`;
      try {
        const credit = await this.wallet.credit(ctx, {
          idempotencyKey: creditKey,
          roundRef,
          operatorPlayerId: session.operator_player_id,
          amount: win,
          currency: session.currency
        });
        this.transactions.record({
          operator_id: session.operator_id,
          session_id: session.id,
          round_ref: roundRef,
          type: "CREDIT",
          amount: win,
          currency: session.currency,
          idempotency_key: creditKey,
          operator_tx_ref: credit.operatorTxRef,
          status: "confirmed"
        });
      } catch {
        settlement = "credit_pending"; // → failed-settlement queue (plan §5 step 9)
        this.transactions.record({
          operator_id: session.operator_id,
          session_id: session.id,
          round_ref: roundRef,
          type: "CREDIT",
          amount: win,
          currency: session.currency,
          idempotency_key: creditKey,
          status: "failed",
          error_code: "WALLET_CREDIT_FAILED"
        });
      }
    }

    // 5) Sync engine-driven game state back onto the session.
    this.sessions.applyResult(session.id, resolved.result);

    const balance = await this.wallet.balance(ctx, {
      operatorPlayerId: session.operator_player_id,
      currency: session.currency
    });

    const outcome: SpinOutcome = {
      round_ref: roundRef,
      outcome_hash: resolved.outcome_hash,
      bet_charged: charge,
      total_win: win,
      balance,
      free_spins_left: Number(resolved.result.free_spins_left ?? 0),
      settlement,
      idempotent_replay: false,
      result: resolved.result
    };
    this.idem.set(req.idempotency_key, outcome);
    return outcome;
  }

  /**
   * Pre-spin engine state. Balance is a sentinel (the operator wallet is the money
   * authority in the seamless model); the engine's internal balance is not used for
   * settlement. Free-spins/persistent-multiplier come from the session.
   */
  private snapshotFor(session: Session): SessionSnapshot {
    return {
      gameId: session.game_code,
      balance: Number.MAX_SAFE_INTEGER / 1000,
      freeSpinsLeft: session.free_spins_left,
      freeSpinPersistentMultiplier: session.free_spin_multiplier_carry
    };
  }
}
