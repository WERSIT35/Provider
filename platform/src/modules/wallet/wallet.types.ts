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

interface MoneyMoveArgs {
  idempotencyKey: string;
  roundRef: string;
  operatorPlayerId: string;
  amount: number;
  currency: string;
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

export interface RollbackArgs {
  idempotencyKey: string;
  originalOperatorTxRef: string;
  roundRef: string;
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

/** Thrown when the operator wallet declines a debit (insufficient funds, etc.). */
export class WalletDeclinedError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "WalletDeclinedError";
  }
}
