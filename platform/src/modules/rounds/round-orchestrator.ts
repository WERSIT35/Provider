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
  resolveBuy(snapshot: SessionSnapshot, input: SpinInput): AuthoritativeRound;
}

export interface SpinRequest {
  bet_amount: number;
  ante_enabled?: boolean;
  idempotency_key: string;
}

export interface BuyFeatureRequest {
  bet_amount: number;
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
/**
 * Sentinel engine balance for resolution. In the seamless-wallet model the operator
 * wallet is the money authority, so the engine's internal balance is irrelevant to
 * settlement — but it IS embedded in the outcome the engine returns, so it must be a
 * fixed, replayable constant (captured into the round's pre-state for verification).
 */
const ENGINE_BALANCE_SENTINEL = Number.MAX_SAFE_INTEGER / 1000;

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

    // 3-5) Record the immutable round, credit the win, settle, sync session.
    return this.finalizeRound(session, ctx, {
      idempotencyKey: req.idempotency_key,
      roundRef,
      betAmount: req.bet_amount,
      charge,
      isFreeSpin,
      anteEnabled: Boolean(req.ante_enabled),
      resolveMode: "spin",
      resolved
    });
  }

  /**
   * Buy Free Spins: the player pays bet × buy-cost-multiplier to force the bonus
   * trigger immediately. Same money-safe lifecycle as a paid spin (debit → resolve
   * → record → credit → settle); the awarded free spins land on the session so the
   * subsequent 0-charge free spins flow through the normal spin() path.
   */
  async buyFeature(sessionId: string, req: BuyFeatureRequest): Promise<SpinOutcome> {
    const cached = this.idem.get(req.idempotency_key);
    if (cached) return { ...cached, idempotent_replay: true };

    const session = this.sessions.get(sessionId);
    this.mgmt.assertOperatorActive(session.operator_id);
    if (!session.allowed_bets.includes(req.bet_amount)) throw new Error("INVALID_BET");

    const ctx = { operatorId: session.operator_id };
    const charge = Number((req.bet_amount * this.engine.buyCostMultiplier()).toFixed(2));
    const roundRef = `r_${req.idempotency_key}`;

    // 1) DEBIT the buy cost. Decline aborts the buy entirely.
    const debit = await this.wallet.debit(ctx, {
      idempotencyKey: `${req.idempotency_key}:debit`,
      roundRef,
      operatorPlayerId: session.operator_player_id,
      amount: charge,
      currency: session.currency
    });
    const debitTxRef = debit.operatorTxRef;
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

    // 2) RESOLVE the forced-trigger round. Failure after debit → rollback.
    let resolved: AuthoritativeRound;
    try {
      resolved = this.resolver.resolveBuy(this.snapshotFor(session), { bet_amount: req.bet_amount });
    } catch (err) {
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
      throw err;
    }

    return this.finalizeRound(session, ctx, {
      idempotencyKey: req.idempotency_key,
      roundRef,
      betAmount: req.bet_amount,
      charge,
      isFreeSpin: false,
      anteEnabled: false,
      resolveMode: "buy",
      resolved
    });
  }

  /**
   * Shared round tail (plan §5 steps 3-5): record the immutable round, credit any
   * win (flagging settlement on credit failure rather than dropping it), sync
   * engine state to the session, read back the wallet balance, and cache the
   * outcome under the idempotency key. Used by both spin() and buyFeature().
   */
  private async finalizeRound(
    session: Session,
    ctx: { operatorId: string },
    args: {
      idempotencyKey: string;
      roundRef: string;
      betAmount: number;
      charge: number;
      isFreeSpin: boolean;
      anteEnabled: boolean;
      resolveMode: "spin" | "buy";
      resolved: AuthoritativeRound;
    }
  ): Promise<SpinOutcome> {
    const { idempotencyKey, roundRef, betAmount, charge, isFreeSpin, anteEnabled, resolveMode, resolved } = args;

    // Snapshot the exact pre-spin state BEFORE applyResult mutates the session, so
    // the verification service can deterministically replay this round later.
    const preState = {
      game_code: session.game_code,
      balance: ENGINE_BALANCE_SENTINEL,
      free_spins_left: session.free_spins_left,
      free_spin_multiplier_carry: session.free_spin_multiplier_carry,
      ante_enabled: anteEnabled,
      resolve_mode: resolveMode
    };

    // 3) RECORD the immutable round (legal system of record).
    this.ledger.recordResolvedRound(
      {
        round_ref: roundRef,
        session_id: session.id,
        operator_id: session.operator_id,
        operator_player_id: session.operator_player_id,
        game_id: session.game_id,
        math_config_id: session.math_config_id,
        bet_amount: betAmount,
        bet_charged: charge,
        is_free_spin: isFreeSpin,
        ante_enabled: anteEnabled,
        pre_state: preState
      },
      resolved
    );

    // 4) CREDIT the win. Failure keeps the round and flags settlement.
    const win = Number(resolved.result.total_win ?? 0);
    let settlement: Settlement = "settled";
    if (win > 0) {
      const creditKey = `${idempotencyKey}:credit`;
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
    this.idem.set(idempotencyKey, outcome);
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
      balance: ENGINE_BALANCE_SENTINEL,
      freeSpinsLeft: session.free_spins_left,
      freeSpinPersistentMultiplier: session.free_spin_multiplier_carry
    };
  }
}
