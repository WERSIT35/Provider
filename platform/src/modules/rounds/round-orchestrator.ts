import type { EngineSource, SessionSnapshot } from "../engine/engine.service";
import type { SpinInput, SpinResult } from "../engine/engine.types";
import type { AuthoritativeRound } from "../rng/authoritative-resolver";
import type { SessionService, Session, FeatureLock } from "../session/session.service";
import type { ManagementService } from "../management/management.service";
import type { RoundLedgerService } from "../ledger/round-ledger.service";
import type { OpenIntentInput, RoundIntentStore } from "./round-intents";
import type { InMemoryTransactionStore } from "../wallet/transaction-store";
import { type WalletAdapter, type Money, WalletDeclinedError } from "../wallet/wallet.types";
import type { InMemoryCampaignRepository, ConsumedSpin } from "../campaigns/campaign.repository";
import { DebitReconciler } from "../wallet/debit-reconciler";
import type { RegulatoryService } from "../regulatory/regulatory";
import { metrics } from "../../lib/metrics";

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
 *   validate → [intent] → debit → resolve → record round → [commit] → credit → settle
 *
 * Crash safety (with Postgres, `durability` wired): an intent is COMMITTED before the
 * casino is asked for the stake, and a round with a win is COMMITTED before the casino
 * is asked to pay it. So after a crash every debit has either a committed round or an
 * open intent that boot recovery reverses, and every committed win is either credited
 * or re-credited under the same idempotency key (src/jobs/round-recovery.ts).
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

/** How long a round's outcome stays cached for an idempotent replay (client retries). */
export const IDEMPOTENCY_CACHE_MS = 15 * 60_000;
/**
 * Outcomes kept per session. A client retries its latest request (at most a spin and a
 * buy in flight), so a few suffice; the cap bounds the cache by live sessions instead
 * of by spins per 15 minutes (~1.3 GB at 355 spins/s before the cap).
 */
export const IDEMPOTENCY_CACHE_PER_SESSION = 4;

export class RoundOrchestrator {
  /**
   * Outcomes by idempotency key, with the session that played them (see claimKey), for
   * IDEMPOTENCY_CACHE_MS: long enough for any client retry. An evicted key is still
   * single-use: claimKey finds its round or debit (and, with Postgres, keyUsed does).
   */
  private readonly idem = new Map<string, { sessionId: string; outcome: SpinOutcome; at: number }>();
  /** The cached keys of each session, oldest first (IDEMPOTENCY_CACHE_PER_SESSION). */
  private readonly idemBySession = new Map<string, string[]>();
  private readonly inflight = new Set<string>();
  /** Sessions with a round in progress (see exclusive). */
  private readonly busySessions = new Set<string>();
  private readonly debits: DebitReconciler;

  constructor(
    /** One game's engine, or the GameRegistry: a round uses its session's game. */
    private readonly engines: EngineSource,
    private readonly resolver: ResolverPort,
    private readonly sessions: SessionService,
    private readonly mgmt: ManagementService,
    private readonly wallet: WalletAdapter,
    private readonly ledger: RoundLedgerService,
    private readonly transactions: InMemoryTransactionStore,
    /** Optional so callers without free rounds (tests, tools) need not wire it. */
    private readonly campaigns?: InMemoryCampaignRepository,
    /** Lost-debit handling (in-line retry, then void + reversal); a default one if omitted. */
    debits?: DebitReconciler,
    /** Jurisdiction rules (round pacing, reality check, feature-buy switch); none = no limits. */
    private readonly regulatory?: RegulatoryService,
    /** Write-ahead intents + a way to commit them (Postgres); none = in-memory only. */
    private readonly durability?: {
      intents: RoundIntentStore;
      commit: () => Promise<void>;
      /** Postgres mode: has this key ever been used (beyond what memory still holds)? */
      keyUsed?: (key: string) => Promise<boolean>;
    }
  ) {
    this.debits = debits ?? new DebitReconciler(wallet, transactions);
  }

  /** Drop cached outcomes older than the retry window (Map order = insertion = age). */
  private evictIdem(now = Date.now()): void {
    for (const [key, v] of this.idem) {
      if (now - v.at <= IDEMPOTENCY_CACHE_MS) break;
      this.forgetIdem(key, v.sessionId);
    }
  }

  private rememberIdem(key: string, sessionId: string, outcome: SpinOutcome): void {
    this.idem.set(key, { sessionId, outcome, at: Date.now() });
    const keys = this.idemBySession.get(sessionId) ?? [];
    keys.push(key);
    this.idemBySession.set(sessionId, keys);
    while (keys.length > IDEMPOTENCY_CACHE_PER_SESSION) this.idem.delete(keys.shift() as string);
    this.evictIdem();
  }

  private forgetIdem(key: string, sessionId: string): void {
    this.idem.delete(key);
    const keys = this.idemBySession.get(sessionId);
    if (!keys) return;
    const i = keys.indexOf(key);
    if (i >= 0) keys.splice(i, 1);
    if (keys.length === 0) this.idemBySession.delete(sessionId);
  }

  /** Cached outcomes held (tests, metrics). */
  idemSize(): number {
    return this.idem.size;
  }

  /** True while a round for this idempotency key is running (recovery leaves it alone). */
  isInFlight(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Make everything queued so far durable. Retries a transient failure in line (the
   * group-commit chain re-queues the rows); still failing → PERSISTENCE_UNAVAILABLE,
   * before any (further) money moves.
   */
  private async durable(retryDelaysMs: number[] = []): Promise<void> {
    if (!this.durability) return;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.durability.commit();
        return;
      } catch {
        if (attempt >= retryDelaysMs.length) throw new Error("PERSISTENCE_UNAVAILABLE");
        await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
      }
    }
  }

  async spin(sessionId: string, req: SpinRequest): Promise<SpinOutcome> {
    return this.exclusive(sessionId, req.idempotency_key, () => this.spinOnce(sessionId, req));
  }

  /**
   * One round at a time per session, and one use per idempotency key. Both checks and
   * both claims happen synchronously, before the first await, so two requests can never
   * both pass them. Without the session lock, a buy and a spin (or two buys) sent
   * together each read the session BEFORE the other's debit settled: both were paid,
   * and both saw "no feature running", which also bypassed the feature lock. A cached
   * replay of the same key is still answered while the session is busy.
   */
  private async exclusive(sessionId: string, key: string, run: () => Promise<SpinOutcome>): Promise<SpinOutcome> {
    const replay = this.claimKey(sessionId, key);
    if (replay) return replay;
    if (this.busySessions.has(sessionId)) throw new Error("SESSION_BUSY");
    this.busySessions.add(sessionId);
    this.inflight.add(key);
    try {
      return await run();
    } finally {
      this.inflight.delete(key);
      this.busySessions.delete(sessionId);
    }
  }

  /**
   * The idempotency key names the round everywhere: the round ref (`r_<key>`) and the
   * casino wallet keys (`<key>:debit`, `<key>:credit`). So a key is single-use across the
   * whole platform, and tied to the session that used it:
   *  - a repeat from the SAME session returns the stored outcome verbatim (a retry);
   *  - the same key from ANOTHER session is refused (it would read that player's round,
   *    and the casino would take its debit for a repeat of theirs: no charge);
   *  - a retry while the original still runs is refused (no second round);
   *  - a key whose round was voided stays refused (ROUND_VOIDED);
   *  - a key that already made a round or a debit, but whose outcome is not cached (a
   *    restart, or a round rolled back after its debit), is refused BEFORE any money
   *    moves: the casino would otherwise answer the new debit with the old one.
   */
  private claimKey(sessionId: string, key: string): SpinOutcome | null {
    const cached = this.idem.get(key);
    if (cached) {
      if (cached.sessionId !== sessionId) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      return { ...cached.outcome, idempotent_replay: true };
    }
    if (this.inflight.has(key)) throw new Error("REQUEST_IN_PROGRESS");
    if (this.debits.isVoided(`${key}:debit`)) throw new Error("ROUND_VOIDED");
    if (this.ledger.getRound(`r_${key}`) || this.transactions.getByKey(`${key}:debit`)) {
      throw new Error("IDEMPOTENCY_KEY_CONFLICT");
    }
    return null;
  }

  /** A key is single-use for good: refuse one Postgres has seen even if memory forgot it. */
  private async assertKeyUnused(key: string): Promise<void> {
    if (this.durability?.keyUsed && (await this.durability.keyUsed(key))) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
  }

  private async spinOnce(sessionId: string, req: SpinRequest): Promise<SpinOutcome> {
    await this.assertKeyUnused(req.idempotency_key);
    const session = this.sessions.get(sessionId);
    this.mgmt.assertOperatorActive(session.operator_id);

    const ctx = { operatorId: session.operator_id };
    const isFreeSpin = session.free_spins_left > 0;

    // BONUS FEATURE LOCK. Inside the engine's free-spins feature the client's bet and
    // ante are IGNORED (not even validated): the round plays exactly the terms of the
    // round that triggered the feature. See Session.locked_* for the exploit this stops.
    const featureLock = isFreeSpin ? this.featureLockFor(session) : null;
    if (!featureLock && !session.allowed_bets.includes(req.bet_amount)) throw new Error("INVALID_BET");
    // A game without an ante (classic-5x3) refuses one before any money moves.
    if (!featureLock && req.ante_enabled && !this.engines.engineFor(session.game_code).supportsAnte()) throw new Error("ANTE_NOT_AVAILABLE");
    // Jurisdiction gate, before anything is consumed or debited: a due reality check
    // stops every round; pacing applies to round starts, not to a feature's free spins.
    this.regulatory?.beforeRound(session, isFreeSpin ? "feature_spin" : "round");

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
          ? Number((betAmount * this.engines.engineFor(session.game_code).anteMultiplier()).toFixed(2))
          : betAmount;
    const roundRef = `r_${req.idempotency_key}`;
    const debitKey = `${req.idempotency_key}:debit`;

    // Anything that fails before the round is recorded hands the free round back.
    const restoreFreeRound = () => {
      if (freeRound) this.campaigns?.restoreSpin(freeRound.grant.id);
    };
    const intents = this.durability?.intents;
    const intent: OpenIntentInput = {
      idempotency_key: req.idempotency_key,
      round_ref: roundRef,
      operator_id: session.operator_id,
      session_id: session.id,
      operator_player_id: session.operator_player_id,
      currency: session.currency,
      debit_type: charge > 0 || freeRound ? (freeRound ? "FREE_ROUND_BET" : "DEBIT") : null,
      debit_amount: charge,
      campaign_id: freeRound?.campaign.id ?? null,
      game_code: session.game_code,
      round_type: freeRound ? "free_round" : isFreeSpin ? "free_spin" : "paid"
    };

    // 1) DEBIT. Cash: the stake (decline aborts the round). Free round: a tagged
    // 0.00 FREE_ROUND_BET so the casino sees the promo round. Engine free spins: none.
    let debitTxRef: string | null = null;
    let balanceAfterDebit: Money | undefined;
    if (charge > 0 || freeRound) {
      // Write-ahead: the intent is durable BEFORE the casino is asked for money.
      if (intents) {
        intents.open(intent);
        try {
          await this.durable();
        } catch (err) {
          intents.close(req.idempotency_key, "voided");
          restoreFreeRound();
          throw err;
        }
      }
      let debit;
      try {
        // A lost response is retried in line; one that stays unknown voids the round
        // and reverses the debit (DEBIT_UNCONFIRMED). See DebitReconciler.
        debit = await this.debits.debit(
          ctx,
          {
            idempotencyKey: debitKey,
            roundRef,
            operatorPlayerId: session.operator_player_id,
            amount: charge,
            currency: session.currency,
            gameCode: session.game_code,
            roundType: freeRound ? "free_round" : "paid",
            ...(freeRound ? { txType: "FREE_ROUND_BET" as const, campaignId: freeRound.campaign.id } : {})
          },
          {
            operator_id: session.operator_id,
            session_id: session.id,
            type: freeRound ? "FREE_ROUND_BET" : "DEBIT",
            ...(freeRound ? { campaign_id: freeRound.campaign.id } : {})
          }
        );
      } catch (err) {
        // Declined, or unknown and already voided + reversed by the reconciler.
        intents?.close(req.idempotency_key, "voided");
        restoreFreeRound();
        throw err;
      }
      debitTxRef = debit.operatorTxRef;
      balanceAfterDebit = debit.balanceAfter;
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
          originalIdempotencyKey: debitKey,
          roundRef,
          operatorPlayerId: session.operator_player_id,
          amount: charge,
          currency: session.currency
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
      // A failed rollback (thrown above) leaves the intent open for recovery to reverse.
      intents?.close(req.idempotency_key, "voided");
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
      intent,
      balanceAfterDebit,
      featureRef: featureLock?.feature_ref ?? null,
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
    return this.exclusive(sessionId, req.idempotency_key, () => this.buyOnce(sessionId, req));
  }

  private async buyOnce(sessionId: string, req: BuyFeatureRequest): Promise<SpinOutcome> {
    await this.assertKeyUnused(req.idempotency_key);
    const session = this.sessions.get(sessionId);
    this.mgmt.assertOperatorActive(session.operator_id);
    if (session.free_spins_left > 0) throw new Error("FEATURE_IN_PROGRESS");
    if (!session.allowed_bets.includes(req.bet_amount)) throw new Error("INVALID_BET");
    // A game without a feature buy (classic-5x3) refuses it before any money moves.
    if (!this.engines.engineFor(session.game_code).supportsBuy()) throw new Error("FEATURE_BUY_DISABLED");
    this.regulatory?.beforeRound(session, "buy");

    const ctx = { operatorId: session.operator_id };
    const charge = Number((req.bet_amount * this.engines.engineFor(session.game_code).buyCostMultiplier()).toFixed(2));
    const roundRef = `r_${req.idempotency_key}`;

    // 1) DEBIT the buy cost. Decline aborts the buy entirely; an outcome that stays
    // unknown voids it and reverses the debit (DebitReconciler).
    const debitKey = `${req.idempotency_key}:debit`;
    const intents = this.durability?.intents;
    const intent: OpenIntentInput = {
      idempotency_key: req.idempotency_key,
      round_ref: roundRef,
      operator_id: session.operator_id,
      session_id: session.id,
      operator_player_id: session.operator_player_id,
      currency: session.currency,
      debit_type: "DEBIT",
      debit_amount: charge,
      campaign_id: null,
      game_code: session.game_code,
      round_type: "buy"
    };
    if (intents) {
      intents.open(intent);
      try {
        await this.durable();
      } catch (err) {
        intents.close(req.idempotency_key, "voided");
        throw err;
      }
    }
    let debit;
    try {
      debit = await this.debits.debit(
      ctx,
      {
        idempotencyKey: debitKey,
        roundRef,
        operatorPlayerId: session.operator_player_id,
        amount: charge,
        currency: session.currency,
        gameCode: session.game_code,
        roundType: "buy"
      },
      { operator_id: session.operator_id, session_id: session.id, type: "DEBIT" }
      );
    } catch (err) {
      intents?.close(req.idempotency_key, "voided");
      throw err;
    }
    const debitTxRef = debit.operatorTxRef;
    this.transactions.record({
      operator_id: session.operator_id,
      session_id: session.id,
      round_ref: roundRef,
      type: "DEBIT",
      amount: charge,
      currency: session.currency,
      idempotency_key: debitKey,
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
        originalIdempotencyKey: debitKey,
        roundRef,
        operatorPlayerId: session.operator_player_id,
        amount: charge,
        currency: session.currency
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
      intents?.close(req.idempotency_key, "voided");
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
      intent,
      balanceAfterDebit: debit.balanceAfter,
      featureRef: null,
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
      /** The round's write-ahead intent (opened before the debit, if there was one). */
      intent: OpenIntentInput;
      /** The casino's balance after this round's debit, when it said (balanceAfter). */
      balanceAfterDebit?: Money;
      /** Inside the feature: the triggering round's ref (bonus group key). Else null. */
      featureRef: string | null;
      /** The free round this spin consumed (null for cash and feature spins). */
      freeRound: ConsumedSpin | null;
      /** Campaign funding this round: a free round, or a feature one triggered. */
      campaign: { campaign_id: string; grant_id: string } | null;
    }
  ): Promise<SpinOutcome> {
    const { idempotencyKey, roundRef, betAmount, charge, isFreeSpin, anteEnabled, resolveMode, resolved, intent, featureRef, freeRound, campaign } = args;
    // The balance after the round's LAST money move, as the casino reported it on that
    // move (the debit; then the credit, if any). Unknown → one balance call at the end.
    let balanceAfterRound: Money | undefined = args.balanceAfterDebit;
    metrics.rounds.inc({ kind: resolveMode === "buy" ? "buy" : isFreeSpin ? "free_spin" : freeRound ? "free_round" : "paid" });

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
          engine_version: this.engines.engineFor(session.game_code).engineVersion(),
          rules_hash: this.engines.engineFor(session.game_code).rulesHash(),
          ...(campaign ? { campaign_id: campaign.campaign_id, grant_id: campaign.grant_id } : {})
        },
        resolved
      );
    } catch (err) {
      // Not recorded → not played: hand the free round back.
      if (freeRound) this.campaigns?.restoreSpin(freeRound.grant.id);
      throw err;
    }

    // 4) Sync engine-driven game state back onto the session (before any commit, so
    // the round and the session state it leaves behind become durable together).
    // The terms this round was played at: if it triggered the feature, they become
    // the feature lock (bet, currency, ante, the funding campaign, and this round's ref
    // as the bonus group key). Inside the feature the existing lock is kept as is.
    this.sessions.applyResult(session.id, resolved.result, {
      bet: betAmount,
      currency: session.currency,
      ante_enabled: anteEnabled,
      campaign_id: campaign?.campaign_id ?? null,
      grant_id: campaign?.grant_id ?? null,
      feature_ref: featureRef ?? roundRef
    });

    const win = Number(resolved.result.total_win ?? 0);
    const creditType = campaign ? "FREE_ROUND_WIN" : "CREDIT";
    const roundType = freeRound ? "free_round" : isFreeSpin ? "free_spin" : resolveMode === "buy" ? "buy" : "paid";
    const intents = this.durability?.intents;
    if (intents && win > 0) {
      // COMMIT the round before the casino pays it: a crash after this point is
      // finished by recovery (re-credit, same key), never unwound.
      intents.commit(idempotencyKey, intent, { credit_type: creditType, win_amount: win, feature_ref: isFreeSpin ? featureRef : null, round_type: roundType });
      // Not durable → no credit and no success: the rows stay queued; recovery credits
      // the win once they commit, or reverses the stake if they never do.
      await this.durable([150, 600]);
    }

    // 5) CREDIT the win. Failure keeps the round and flags settlement. A campaign-
    // funded win (the free round itself, or any spin of a feature it triggered) goes
    // out as a tagged FREE_ROUND_WIN carrying the campaign id.
    const freeRoundCreditTag = campaign ? { txType: "FREE_ROUND_WIN" as const, campaignId: campaign.campaign_id } : {};
    const freeRoundTxTag = campaign ? { campaign_id: campaign.campaign_id } : {};
    let settlement: Settlement = "settled";
    if (win > 0) {
      const creditKey = `${idempotencyKey}:credit`;
      try {
        balanceAfterRound = undefined; // a credit is due: only ITS answer is the round's balance
        const credit = await this.wallet.credit(ctx, {
          idempotencyKey: creditKey,
          roundRef,
          operatorPlayerId: session.operator_player_id,
          amount: win,
          currency: session.currency,
          gameCode: session.game_code,
          roundType,
          ...(isFreeSpin && featureRef ? { featureRef } : {}),
          ...freeRoundCreditTag
        });
        balanceAfterRound = credit.balanceAfter;
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
    // Done with the casino for this round (a failed credit is in the settlement queue).
    intents?.close(idempotencyKey, "settled");

    // The casino already said the balance on the round's last move (a debit or credit
    // response's balanceAfter, part of the wallet protocol): no third call per round.
    // Asked only when no move answered it: a free spin with no win, a failed credit,
    // or a casino that leaves balanceAfter out.
    const balance =
      balanceAfterRound ??
      (await this.wallet.balance(ctx, {
        operatorPlayerId: session.operator_player_id,
        currency: session.currency
      }));

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
    this.rememberIdem(idempotencyKey, session.id, outcome);
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
      grant_id: last.grant_id ?? null,
      // The feature began at the session's newest round that was not a free spin.
      feature_ref: this.ledger.lastTriggerRoundForSession(session.id)?.round_ref ?? null
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
