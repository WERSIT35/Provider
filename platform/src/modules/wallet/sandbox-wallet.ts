import { randomUUID } from "node:crypto";
import {
  type WalletAdapter,
  type WalletContext,
  type Money,
  type DebitArgs,
  type CreditArgs,
  type RollbackArgs,
  type WalletTxResult,
  type WalletRollbackResult,
  WalletDeclinedError
} from "./wallet.types";

/**
 * In-memory operator wallet stub for sandbox/testing. Models the seamless-wallet
 * contract: holds player balances and is fully idempotent — replaying a request
 * with the same idempotencyKey returns the SAME result and never moves money twice
 * (plan §9). A `failCreditFor` hook lets tests exercise settlement-failure paths.
 */
export class SandboxWallet implements WalletAdapter {
  private readonly balances = new Map<string, number>();
  private readonly applied = new Map<string, WalletTxResult | WalletRollbackResult>();
  private readonly debitByRef = new Map<string, { balanceKey: string; amount: number }>();

  constructor(private readonly opts: { failCreditFor?: (args: CreditArgs) => boolean } = {}) {}

  private key(playerId: string, currency: string): string {
    return `${playerId}:${currency}`;
  }

  setBalance(operatorPlayerId: string, currency: string, amount: number): void {
    this.balances.set(this.key(operatorPlayerId, currency), amount);
  }

  async balance(_ctx: WalletContext, args: { operatorPlayerId: string; currency: string }): Promise<Money> {
    return { amount: this.balances.get(this.key(args.operatorPlayerId, args.currency)) ?? 0, currency: args.currency };
  }

  async debit(_ctx: WalletContext, args: DebitArgs): Promise<WalletTxResult> {
    const cached = this.applied.get(args.idempotencyKey);
    if (cached) return cached as WalletTxResult;

    const k = this.key(args.operatorPlayerId, args.currency);
    const current = this.balances.get(k) ?? 0;
    if (current < args.amount) {
      throw new WalletDeclinedError("INSUFFICIENT_FUNDS");
    }
    this.balances.set(k, Number((current - args.amount).toFixed(2)));
    const result: WalletTxResult = {
      operatorTxRef: `otx_${randomUUID()}`,
      balanceAfter: { amount: this.balances.get(k) as number, currency: args.currency },
      status: "confirmed"
    };
    this.applied.set(args.idempotencyKey, result);
    this.debitByRef.set(result.operatorTxRef, { balanceKey: k, amount: args.amount });
    return result;
  }

  async credit(_ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult> {
    const cached = this.applied.get(args.idempotencyKey);
    if (cached) return cached as WalletTxResult;

    if (this.opts.failCreditFor?.(args)) {
      throw new Error("WALLET_CREDIT_FAILED");
    }
    const k = this.key(args.operatorPlayerId, args.currency);
    const current = this.balances.get(k) ?? 0;
    this.balances.set(k, Number((current + args.amount).toFixed(2)));
    const result: WalletTxResult = {
      operatorTxRef: `otx_${randomUUID()}`,
      balanceAfter: { amount: this.balances.get(k) as number, currency: args.currency },
      status: "confirmed"
    };
    this.applied.set(args.idempotencyKey, result);
    return result;
  }

  async rollback(_ctx: WalletContext, args: RollbackArgs): Promise<WalletRollbackResult> {
    const cached = this.applied.get(args.idempotencyKey);
    if (cached) return cached as WalletRollbackResult;

    // Reverse the original debit by its operator tx ref (restores the player balance).
    const debit = this.debitByRef.get(args.originalOperatorTxRef);
    if (debit) {
      const current = this.balances.get(debit.balanceKey) ?? 0;
      this.balances.set(debit.balanceKey, Number((current + debit.amount).toFixed(2)));
    }
    const result: WalletRollbackResult = { operatorTxRef: `otx_${randomUUID()}`, status: "rolled_back" };
    this.applied.set(args.idempotencyKey, result);
    return result;
  }
}
