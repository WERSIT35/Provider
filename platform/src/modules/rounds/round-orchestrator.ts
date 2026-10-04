import type { EngineService, SessionSnapshot } from "../engine/engine.service";
import type { SpinInput, SpinResult } from "../engine/engine.types";
import type { AuthoritativeRound } from "../rng/authoritative-resolver";
import type { SessionService, Session, FeatureLock } from "../session/session.service";
import type { ManagementService } from "../management/management.service";
import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { InMemoryTransactionStore } from "../wallet/transaction-store";
import { type WalletAdapter, type Money, WalletDeclinedError } from "../wallet/wallet.types";
import type { InMemoryCampaignRepository, ConsumedSpin } from "../campaigns/campaign.repository";

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

/** Present when the round was an operator free round (Campaign Manager). */
export interface FreeRoundInfo {
  campaign_id: string;
  grant_id: string;
  bet_amount: number; // the locked bet the round was played at
  spins_remaining: number; // left on this grant after this round
}

export interface SpinOutcome {
  round_ref: string;
  outcome_hash: string;
  bet_charged: number;
  total_win: number;
  balance: Money;
  free_spins_left: number;
  settlement: Settlement;
  idempotent_replay: boolean;
  free_round: FreeRoundInfo | null;
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
  private readonly inflight = new Set<string>();

  constructor(
    private readonly engine: EngineService,
    private readonly resolver: ResolverPort,
    private readonly sessions: SessionService,
    private readonly mgmt: ManagementService,
    private readonly wallet: WalletAdapter,
    private readonly ledger: RoundLedgerService,
    private readonly transactions: InMemoryTransactionStore,
    /** Optional so callers without free rounds (tests, tools) need not wire it. */
    private readonly campaigns?: InMemoryCampaignRepository
  ) {}

  async spin(sessionId: string, req: SpinRequest): Promise<SpinOutcome> {
    // App-level idempotency: a repeated key returns the stored outcome verbatim.
    const cached = this.idem.get(req.idempotency_key);
    if (cached) return { ...cached, idempotent_replay: true };
    // A retry that arrives while the original is still running must not play a
    // second round (it would burn a second free round, or race the ledger).
    if (this.inflight.has(req.idempotency_key)) throw new Error("REQUEST_IN_PROGRESS");
    this.inflight.add(req.idempotency_key);
    try {
      return await this.spinOnce(sessionId, req);
    } finally {
      this.inflight.delete(req.idempotency_key);
    }
  }

  private async spinOnce(sessionId: string, req: SpinRequest): Promise<SpinOutcome> {
    const session = this.sessions.get(sessionId);
    this.mgmt.assertOperatorActive(session.operator_id);

    const ctx = { operatorId: session.operator_id };
    const isFreeSpin = session.free_spins_left > 0;

    // BONUS FEATURE LOCK. Inside the engine's free-spins feature the client's bet and
    // ante are IGNORED (not even validated): the round plays exactly the terms of the
    // round that triggered the feature. See Session.locked_* for the exploit this stops.
    const featureLock = isFreeSpin ? this.featureLockFor(session) : null;
    if (!featureLock && !session.allowed_bets.includes(req.bet_amount)) throw new Error("INVALID_BET");

    // Operator free round (Campaign Manager). Taken BEFORE any real-money step, and
    // never inside the engine's own feature (those spins are already free).
    // consumeSpin() is synchronous, so concurrent spins can't both take the last one.
    // null → no usable grant → this is an ordinary cash spin.
    const freeRound = isFreeSpin
      ? null
      : (this.campaigns?.consumeSpin({
          operator_id: session.operator_id,
          operator_player_id: session.operator_player_id,
          game_id: session.game_id,
          currency: session.currency
        }) ?? null);

    // Terms: feature lock > free round's locked bet (no ante) > the client's request.
    const betAmount = featureLock ? featureLock.bet : freeRound ? freeRound.campaign.bet_amount : req.bet_amount;
    const anteEnabled = featureLock ? featureLock.ante_enabled : freeRound ? false : Boolean(req.ante_enabled);
    const charge =
      isFreeSpin || freeRound
        ? 0
        : anteEnabled
          ? Number((betAmount * this.engine.anteMultiplier()).toFixed(2))
          : betAmount;
    const roundRef = `r_${req.idempotency_key}`;
    const debitKey = `${req.idempotency_key}:debit`;

    // Anything that fails before the round is recorded hands the free round back.
    const restoreFreeRound = () => {
      if (freeRound) this.campaigns?.restoreSpin(freeRound.grant.id);
    };

    // 1) DEBIT. Cash: the stake (decline aborts the round). Free round: a tagged
    // 0.00 FREE_ROUND_BET so the casino sees the promo round. Engine free spins: none.
    let debitTxRef: string | null = null;
    if (charge > 0 || freeRound) {
      let debit;
      try {
        debit = await this.wallet.debit(ctx, {
          idempotencyKey: debitKey,
          roundRef,
          operatorPlayerId: session.operator_player_id,
          amount: charge,
          currency: session.currency,
          ...(freeRound ? { txType: "FREE_ROUND_BET" as const, campaignId: freeRound.campaign.id } : {})
        });
      } catch (err) {
        restoreFreeRound();
        throw err;
      }
      debitTxRef = debit.operatorTxRef;
      this.transactions.record({
        operator_id: session.operator_id,
        session_id: session.id,
        round_ref: roundRef,
        type: freeRound ? "FREE_ROUND_BET" : "DEBIT",
        amount: charge,
        currency: session.currency,
        idempotency_key: debitKey,
        operator_tx_ref: debitTxRef,
        status: "confirmed",
        ...(freeRound ? { campaign_id: freeRound.campaign.id } : {})
      });
    }

    // 2) RESOLVE (server-authoritative, seeded). Failure after debit → rollback.
    let resolved: AuthoritativeRound;
    try {
      resolved = this.resolver.resolve(this.snapshotFor(session), {
        bet_amount: betAmount,
        ante_enabled: anteEnabled
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
          status: "rolled_back",
          ...(freeRound ? { campaign_id: freeRound.campaign.id } : {})
        });
      }
      restoreFreeRound();
      throw err;
    }

    // 3-5) Record the immutable round, credit the win, settle, sync session.
    return this.finalizeRound(session, ctx, {
      idempotencyKey: req.idempotency_key,
      roundRef,
      betAmount,
      charge,
      isFreeSpin,
      anteEnabled,
      resolveMode: "spin",
      resolved,
      freeRound,
      campaign: freeRound
        ? { campaign_id: freeRound.campaign.id, grant_id: freeRound.grant.id }
        : featureLock?.campaign_id && featureLock.grant_id
          ? { campaign_id: featureLock.campaign_id, grant_id: featureLock.grant_id }
          : null
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
    if (session.free_spins_left > 0) throw new Error("FEATURE_IN_PROGRESS");
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
      resolved,
      freeRound: null,
      campaign: null
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
      /** The free round this spin consumed (null for cash and feature spins). */
      freeRound: ConsumedSpin | null;
      /** Campaign funding this round: a free round, or a feature one triggered. */
      campaign: { campaign_id: string; grant_id: string } | null;
    }
  ): Promise<SpinOutcome> {
    const { idempotencyKey, roundRef, betAmount, charge, isFreeSpin, anteEnabled, resolveMode, resolved, freeRound, campaign } = args;

    // Snapshot the exact pre-spin state BEFORE applyResult mutates the session, so
    // the verification service can deterministically replay this round later.
    const preState = {
      game_code: session.game_code,
      balance: ENGINE_BALANCE_SENTINEL,
      free_spins_left: session.free_spins_left,
      free_spin_multiplier_carry: session.free_spin_multiplier_carry,
      bonus_round_win: session.bonus_round_win ?? 0,
      ante_enabled: anteEnabled,
      resolve_mode: resolveMode
    };

    // 3) RECORD the immutable round (legal system of record).
    try {
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
          pre_state: preState,
          engine_version: this.engine.engineVersion(),
          ...(campaign ? { campaign_id: campaign.campaign_id, grant_id: campaign.grant_id } : {})
        },
        resolved
      );
    } catch (err) {
      // Not recorded → not played: hand the free round back.
      if (freeRound) this.campaigns?.restoreSpin(freeRound.grant.id);
      throw err;
    }

    // 4) CREDIT the win. Failure keeps the round and flags settlement. A campaign-
    // funded win (the free round itself, or any spin of a feature it triggered) goes
    // out as a tagged FREE_ROUND_WIN carrying the campaign id.
    const win = Number(resolved.result.total_win ?? 0);
    const creditType = campaign ? "FREE_ROUND_WIN" : "CREDIT";
    const freeRoundCreditTag = campaign ? { txType: "FREE_ROUND_WIN" as const, campaignId: campaign.campaign_id } : {};
    const freeRoundTxTag = campaign ? { campaign_id: campaign.campaign_id } : {};
    let settlement: Settlement = "settled";
    if (win > 0) {
      const creditKey = `${idempotencyKey}:credit`;
      try {
        const credit = await this.wallet.credit(ctx, {
          idempotencyKey: creditKey,
          roundRef,
          operatorPlayerId: session.operator_player_id,
          amount: win,
          currency: session.currency,
          ...freeRoundCreditTag
        });
        this.transactions.record({
          operator_id: session.operator_id,
          session_id: session.id,
          round_ref: roundRef,
          type: creditType,
          amount: win,
          currency: session.currency,
          idempotency_key: creditKey,
          operator_tx_ref: credit.operatorTxRef,
          status: "confirmed",
          ...freeRoundTxTag
        });
      } catch {
        settlement = "credit_pending"; // → failed-settlement queue (plan §5 step 9)
        this.transactions.record({
          operator_id: session.operator_id,
          session_id: session.id,
          round_ref: roundRef,
          type: creditType,
          amount: win,
          currency: session.currency,
          idempotency_key: creditKey,
          status: "failed",
          error_code: "WALLET_CREDIT_FAILED",
          ...freeRoundTxTag
        });
      }
    }
    // The win is owed whether or not the credit landed yet (failed credits go to the
    // settlement queue), so it counts toward the grant's promotional liability now.
    const grantAfter = campaign ? this.campaigns?.recordWin(campaign.grant_id, win) : null;

    // 5) Sync engine-driven game state back onto the session.
    // The terms this round was played at: if it triggered the feature, they become
    // the feature lock (bet, currency, ante, and the funding campaign).
    this.sessions.applyResult(session.id, resolved.result, {
      bet: betAmount,
      currency: session.currency,
      ante_enabled: anteEnabled,
      campaign_id: campaign?.campaign_id ?? null,
      grant_id: campaign?.grant_id ?? null
    });

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
      free_round: freeRound
        ? {
            campaign_id: freeRound.campaign.id,
            grant_id: freeRound.grant.id,
            bet_amount: freeRound.campaign.bet_amount,
            spins_remaining: grantAfter?.spins_remaining ?? freeRound.grant.spins_remaining
          }
        : null,
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
  /**
   * The lock for a session that is inside the feature. A session that entered the
   * feature before locks existed has none: rebuild it from the session's last
   * recorded round (the trigger or an earlier feature spin, all at the trigger's
   * terms) and persist it, so the client's bet is never trusted mid-feature.
   */
  private featureLockFor(session: Session): FeatureLock {
    const lock = this.sessions.featureLock(session.id);
    if (lock) {
      if (lock.currency !== session.currency) throw new Error("SESSION_LOCK_MISMATCH");
      return lock;
    }
    const last = this.ledger.lastRoundForSession(session.id);
    if (!last) throw new Error("SESSION_LOCK_MISSING");
    const rebuilt: FeatureLock = {
      bet: last.bet_amount,
      currency: session.currency,
      ante_enabled: last.ante_enabled,
      campaign_id: last.campaign_id ?? null,
      grant_id: last.grant_id ?? null
    };
    this.sessions.lockFeature(session.id, rebuilt);
    return rebuilt;
  }

  private snapshotFor(session: Session): SessionSnapshot {
    return {
      gameId: session.game_code,
      balance: ENGINE_BALANCE_SENTINEL,
      freeSpinsLeft: session.free_spins_left,
      freeSpinPersistentMultiplier: session.free_spin_multiplier_carry,
      bonusRoundWin: session.bonus_round_win ?? 0
    };
  }
}
