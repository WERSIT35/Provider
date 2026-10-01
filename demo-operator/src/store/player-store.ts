import { randomUUID } from "node:crypto";

/**
 * Player identity + real-money-style balance for THIS site. Deliberately a plain
 * in-memory store (no write-through persistence layer): this is a demo proving
 * the platform integration works over the wire, not a production identity system —
 * see demo-operator's README for the explicit scope call. Restarting the process
 * clears everyone's balance (the platform's own round/ledger history does not
 * reset, since platform is the source of truth for gameplay — see GUIDE.md).
 */
export interface Player {
  id: string;
  email: string;
  passwordHash: string;
  balance: number;
  createdAt: string;
}

export type TxType = "debit" | "credit" | "rollback";

export interface PlayerTransaction {
  id: string;
  seq: number;
  playerId: string;
  type: TxType;
  amount: number;
  currency: string;
  roundRef: string;
  idempotencyKey: string;
  operatorTxRef: string;
  createdAt: string;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super("INSUFFICIENT_FUNDS");
    this.name = "InsufficientFundsError";
  }
}

interface AppliedResult {
  operatorTxRef: string;
  balanceAfter: number;
}

export class PlayerStore {
  private readonly players = new Map<string, Player>();
  private readonly byEmail = new Map<string, string>(); // email -> id
  private readonly transactions: PlayerTransaction[] = [];
  // Idempotency: a retried debit/credit/rollback with the same key returns the
  // exact same result instead of moving money twice (mirrors SandboxWallet).
  private readonly applied = new Map<string, AppliedResult>();
  // Lets a rollback reverse the exact debit it targets, by the operatorTxRef we
  // handed back for that debit (mirrors SandboxWallet's debitByRef).
  private readonly debitByRef = new Map<string, { playerId: string; amount: number }>();

  register(email: string, passwordHash: string, startingBalance: number): Player {
    const normalized = email.trim().toLowerCase();
    if (this.byEmail.has(normalized)) throw new Error("EMAIL_TAKEN");
    const player: Player = {
      id: randomUUID(),
      email: normalized,
      passwordHash,
      balance: startingBalance,
      createdAt: new Date().toISOString()
    };
    this.players.set(player.id, player);
    this.byEmail.set(normalized, player.id);
    return { ...player };
  }

  findByEmail(email: string): Player | null {
    const id = this.byEmail.get(email.trim().toLowerCase());
    if (!id) return null;
    const p = this.players.get(id);
    return p ? { ...p } : null;
  }

  getById(id: string): Player | null {
    const p = this.players.get(id);
    return p ? { ...p } : null;
  }

  transactionsFor(playerId: string): PlayerTransaction[] {
    return this.transactions
      .filter((t) => t.playerId === playerId)
      .sort((a, b) => b.seq - a.seq)
      .map((t) => ({ ...t }));
  }

  getAllPlayers(): Player[] {
    return Array.from(this.players.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getAllTransactions(): PlayerTransaction[] {
    return [...this.transactions].sort((a, b) => b.seq - a.seq);
  }

  /** Debit the player's balance. Rejects (no balance change) if funds are insufficient. */
  debit(args: { playerId: string; idempotencyKey: string; amount: number; currency: string; roundRef: string }): AppliedResult {
    const cached = this.applied.get(args.idempotencyKey);
    if (cached) return cached;
    const player = this.players.get(args.playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    if (player.balance < args.amount) throw new InsufficientFundsError();
    player.balance = Number((player.balance - args.amount).toFixed(2));
    const operatorTxRef = `dop_${randomUUID()}`;
    this.record("debit", args, operatorTxRef);
    this.debitByRef.set(operatorTxRef, { playerId: args.playerId, amount: args.amount });
    const result: AppliedResult = { operatorTxRef, balanceAfter: player.balance };
    this.applied.set(args.idempotencyKey, result);
    return result;
  }

  credit(args: { playerId: string; idempotencyKey: string; amount: number; currency: string; roundRef: string }): AppliedResult {
    const cached = this.applied.get(args.idempotencyKey);
    if (cached) return cached;
    const player = this.players.get(args.playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    player.balance = Number((player.balance + args.amount).toFixed(2));
    const operatorTxRef = `dop_${randomUUID()}`;
    this.record("credit", args, operatorTxRef);
    const result: AppliedResult = { operatorTxRef, balanceAfter: player.balance };
    this.applied.set(args.idempotencyKey, result);
    return result;
  }

  rollback(args: { idempotencyKey: string; originalOperatorTxRef: string; roundRef: string; currency: string }): AppliedResult {
    const cached = this.applied.get(args.idempotencyKey);
    if (cached) return cached;
    const debit = this.debitByRef.get(args.originalOperatorTxRef);
    if (!debit) throw new Error("ORIGINAL_DEBIT_NOT_FOUND");
    const player = this.players.get(debit.playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    player.balance = Number((player.balance + debit.amount).toFixed(2));
    const operatorTxRef = `dop_${randomUUID()}`;
    this.record(
      "rollback",
      { playerId: debit.playerId, idempotencyKey: args.idempotencyKey, amount: debit.amount, currency: args.currency, roundRef: args.roundRef },
      operatorTxRef
    );
    const result: AppliedResult = { operatorTxRef, balanceAfter: player.balance };
    this.applied.set(args.idempotencyKey, result);
    return result;
  }

  private record(
    type: TxType,
    args: { playerId: string; idempotencyKey: string; amount: number; currency: string; roundRef: string },
    operatorTxRef: string
  ): void {
    this.transactions.push({
      id: randomUUID(),
      seq: this.transactions.length,
      playerId: args.playerId,
      type,
      amount: args.amount,
      currency: args.currency,
      roundRef: args.roundRef,
      idempotencyKey: args.idempotencyKey,
      operatorTxRef,
      createdAt: new Date().toISOString()
    });
  }
}
