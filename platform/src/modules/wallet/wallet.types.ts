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

export interface DebitArgs {
  idempotencyKey: string;
  roundRef: string;
  operatorPlayerId: string;
  amount: number;
  currency: string;
}

export type CreditArgs = DebitArgs;

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
