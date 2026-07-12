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
import { NullPersistence, type Persistence } from "../../persistence/persistence";

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
  private persistence: Persistence = NullPersistence;

  constructor(private readonly opts: { failCreditFor?: (args: CreditArgs) => boolean } = {}) {}

  /** Attach a persistence port (write-through). Called by the container when PG is on. */
  usePersistence(p: Persistence): void {
    this.persistence = p;
  }

  /** Rebuild balances/idempotency/debit-refs from Postgres on boot. */
  hydrate(data: {
    balances: Array<{ balance_key: string; amount: number }>;
    applied: Array<{ idempotency_key: string; result: WalletTxResult | WalletRollbackResult }>;
    debitRefs: Array<{ operator_tx_ref: string; balance_key: string; amount: number }>;
  }): void {
    for (const b of data.balances) this.balances.set(b.balance_key, b.amount);
    for (const a of data.applied) this.applied.set(a.idempotency_key, a.result);
    for (const d of data.debitRefs) this.debitByRef.set(d.operator_tx_ref, { balanceKey: d.balance_key, amount: d.amount });
  }

  private key(playerId: string, currency: string): string {
    return `${playerId}:${currency}`;
  }

  private persistBalance(balanceKey: string): void {
    this.persistence.save("wallet_balances", { balance_key: balanceKey, amount: this.balances.get(balanceKey) ?? 0 });
  }

  setBalance(operatorPlayerId: string, currency: string, amount: number): void {
    const k = this.key(operatorPlayerId, currency);
    this.balances.set(k, amount);
    this.persistBalance(k);
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
    this.persistBalance(k);
    this.persistence.save("wallet_applied", { idempotency_key: args.idempotencyKey, result });
    this.persistence.save("wallet_debit_refs", { operator_tx_ref: result.operatorTxRef, balance_key: k, amount: args.amount });
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
    this.persistBalance(k);
    this.persistence.save("wallet_applied", { idempotency_key: args.idempotencyKey, result });
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
      this.persistBalance(debit.balanceKey);
    }
    const result: WalletRollbackResult = { operatorTxRef: `otx_${randomUUID()}`, status: "rolled_back" };
    this.applied.set(args.idempotencyKey, result);
    this.persistence.save("wallet_applied", { idempotency_key: args.idempotencyKey, result });
    return result;
  }
}
