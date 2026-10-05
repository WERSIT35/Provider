/** Generic wallet adapter (plan §9). One implementation per operator; the core only
 * ever speaks this canonical interface. Seamless/single-wallet model: the operator is
 * the source of truth for player funds. */

export interface Money {
  amount: number;
  currency: string;
}

export interface WalletContext {
  operatorId: string;
}

/** What kind of round a money move belongs to (sent to the casino in the webhook body). */
export type RoundType = "paid" | "free_spin" | "buy" | "free_round";

interface MoneyMoveArgs {
  idempotencyKey: string;
  roundRef: string;
  operatorPlayerId: string;
  amount: number;
  currency: string;
  /** Game the round belongs to, so the casino ledger can attribute it without calling us. */
  gameCode?: string;
  /** paid (cash spin) · free_spin (engine bonus spin, never debited) · buy · free_round (operator grant). */
  roundType?: RoundType;
  /**
   * Bonus grouping: on every money move of an engine free spin, the round_ref of the
   * round that triggered the feature (a paid spin, a buy or a free round). The casino
   * groups a bonus as that trigger round plus every move carrying its ref. Absent
   * outside the feature. Free spins that win nothing move no money, so send nothing.
   */
  featureRef?: string;
}

/**
 * Operator-granted free rounds are tagged explicitly so the casino can tell them
 * apart from cash play and reconcile its promotional liability by campaign:
 *   • FREE_ROUND_BET — amount is always 0.00; the player is not charged.
 *   • FREE_ROUND_WIN — the win credited from a free round.
 * Both carry campaignId. Untagged calls (txType omitted) are ordinary cash
 * bets/wins, so the existing webhook payload is unchanged for them.
 */
export type FreeRoundDebitType = "FREE_ROUND_BET";
export type FreeRoundCreditType = "FREE_ROUND_WIN";

export interface DebitArgs extends MoneyMoveArgs {
  txType?: FreeRoundDebitType;
  campaignId?: string;
}

export interface CreditArgs extends MoneyMoveArgs {
  txType?: FreeRoundCreditType;
  campaignId?: string;
}

/** A tagged call must be internally consistent; never let a "free" bet move money. */
export function assertFreeRoundArgs(args: DebitArgs | CreditArgs): void {
  if (!args.txType) return;
  if (!args.campaignId) throw new Error("FREE_ROUND_CAMPAIGN_REQUIRED");
  if (args.txType === "FREE_ROUND_BET" && args.amount !== 0) throw new Error("FREE_ROUND_BET_MUST_BE_ZERO");
}

/**
 * Reverse a debit. The debit is named by the casino's `originalOperatorTxRef` when
 * the RGS received it, and ALWAYS by `originalIdempotencyKey` (the debit's own key),
 * which is the only handle when the debit's response was lost. Casino semantics for
 * a rollback by key:
 *   • the debit exists → refund it (at most once);
 *   • it does not → record the key as VOIDED and answer rolled_back: a debit that
 *     arrives later under that key must be refused (TRANSACTION_VOIDED), never applied.
 * `operatorPlayerId` / `amount` / `currency` describe the debit as the RGS sent it.
 */
export interface RollbackArgs {
  idempotencyKey: string;
  originalOperatorTxRef?: string;
  originalIdempotencyKey?: string;
  roundRef: string;
  operatorPlayerId?: string;
  amount?: number;
  currency?: string;
}

export interface WalletTxResult {
  operatorTxRef: string;
  balanceAfter?: Money;
  status: "confirmed";
}

export interface WalletRollbackResult {
  operatorTxRef: string;
  status: "rolled_back";
}

export interface WalletAdapter {
  balance(ctx: WalletContext, args: { operatorPlayerId: string; currency: string }): Promise<Money>;
  debit(ctx: WalletContext, args: DebitArgs): Promise<WalletTxResult>;
  credit(ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult>;
  rollback(ctx: WalletContext, args: RollbackArgs): Promise<WalletRollbackResult>;
}

/**
 * Errors raised before any request left the RGS: the casino cannot have applied
 * anything, so they are not "outcome unknown".
 */
const NOT_SENT = new Set(["WEBHOOK_NOT_CONFIGURED", "FREE_ROUND_CAMPAIGN_REQUIRED", "FREE_ROUND_BET_MUST_BE_ZERO"]);

/**
 * True when a failed wallet call may still have been applied by the casino (timeout,
 * dropped connection, a 5xx without a decline code). A WalletDeclinedError is a
 * definite answer: nothing was applied.
 */
export function isOutcomeUnknown(err: unknown): boolean {
  if (err instanceof WalletDeclinedError) return false;
  return !(err instanceof Error && NOT_SENT.has(err.message));
}

/** Thrown when the operator wallet declines a debit (insufficient funds, etc.). */
export class WalletDeclinedError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "WalletDeclinedError";
  }
}
