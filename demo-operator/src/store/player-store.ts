import { randomUUID } from "node:crypto";
import { openCasinoDb, inTransaction, toMinor, toMajor, type CasinoDatabase } from "../db/database";

/**
 * Player identity + balance for THIS site, and the casino's wallet ledger: every
 * debit / credit / rollback the RGS requests through the signed webhook is written as
 * an append-only row (see db/database.ts). Backed by SQLite, so balances and history
 * survive restarts. The platform remains the source of truth for gameplay; this ledger
 * is the casino's own record of the money it moved.
 */
export interface Player {
  id: string;
  email: string;
  passwordHash: string;
  balance: number;
  createdAt: string;
}

export type TxType = "debit" | "credit" | "rollback";
/** Ledger classification of a money movement (casino-side naming). */
export type LedgerTxType = "WAGER" | "FREE_ROUND_BET" | "CREDIT" | "FREE_ROUND_WIN" | "ROLLBACK";
export type RoundType = "paid" | "free_spin" | "buy" | "free_round";

export interface PlayerTransaction {
  id: string;
  seq: number;
  providerId: string;
  playerId: string;
  type: TxType;
  txType: LedgerTxType;
  amount: number;
  currency: string;
  roundRef: string;
  gameCode: string | null;
  roundType: RoundType | null;
  campaignId: string | null;
  /** Bonus group: round_ref of the round that triggered the feature (free-spin moves only). */
  featureRef: string | null;
  idempotencyKey: string;
  operatorTxRef: string;
  reversesTxRef: string | null;
  balanceAfter: number;
  createdAt: string;
}

/** One round as the casino saw it: its wager and win, net of any rollback. */
export interface LedgerRound {
  roundRef: string;
  providerId: string;
  playerId: string;
  playerEmail: string | null;
  gameCode: string | null;
  roundType: RoundType | null;
  campaignId: string | null;
  /** Free spins: the trigger round's ref (the bonus this round belongs to). Else null. */
  featureRef: string | null;
  currency: string;
  bet: number;
  win: number;
  rolledBack: boolean;
  startedAt: string;
  settledAt: string;
}

/** A bonus as the casino saw it: its trigger round plus the free spins that paid. */
export interface BonusSummary {
  featureRef: string;
  /** Free spins that moved money (a free spin that wins nothing sends no webhook). */
  payingSpins: number;
  win: number;
  currency: string;
  firstAt: string;
  lastAt: string;
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

/** Fields the RGS may attach to a debit/credit (all signed in the webhook body). */
export interface MoneyMoveMeta {
  providerId?: string;
  txType?: string;
  gameCode?: string;
  roundType?: string;
  campaignId?: string;
  featureRef?: string;
}

interface MoneyMove extends MoneyMoveMeta {
  playerId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  roundRef: string;
}

const DEFAULT_PROVIDER = "default-provider";
const ROUND_TYPES = new Set(["paid", "free_spin", "buy", "free_round"]);

interface PlayerRow { id: string; email: string; password_hash: string; balance_minor: number; created_at: string }
interface TxRow {
  seq: number; id: string; provider_id: string; player_id: string; kind: TxType; tx_type: LedgerTxType;
  amount_minor: number; currency: string; round_ref: string; game_code: string | null; round_type: RoundType | null;
  campaign_id: string | null; feature_ref: string | null; idempotency_key: string; operator_tx_ref: string;
  reverses_tx_ref: string | null; balance_after_minor: number; created_at: string;
}

const toPlayer = (r: PlayerRow): Player => ({
  id: r.id, email: r.email, passwordHash: r.password_hash, balance: toMajor(r.balance_minor), createdAt: r.created_at
});
const toTx = (r: TxRow): PlayerTransaction => ({
  id: r.id, seq: r.seq, providerId: r.provider_id, playerId: r.player_id, type: r.kind, txType: r.tx_type,
  amount: toMajor(r.amount_minor), currency: r.currency, roundRef: r.round_ref, gameCode: r.game_code,
  roundType: r.round_type, campaignId: r.campaign_id, featureRef: r.feature_ref ?? null, idempotencyKey: r.idempotency_key,
  operatorTxRef: r.operator_tx_ref, reversesTxRef: r.reverses_tx_ref, balanceAfter: toMajor(r.balance_after_minor),
  createdAt: r.created_at
});

export class PlayerStore {
  constructor(private readonly db: CasinoDatabase = openCasinoDb()) {}

  register(email: string, passwordHash: string, startingBalance: number): Player {
    const normalized = email.trim().toLowerCase();
    if (this.findByEmail(normalized)) throw new Error("EMAIL_TAKEN");
    const row: PlayerRow = {
      id: randomUUID(), email: normalized, password_hash: passwordHash,
      balance_minor: toMinor(startingBalance), created_at: new Date().toISOString()
    };
    this.db
      .prepare("INSERT INTO players (id, email, password_hash, balance_minor, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.email, row.password_hash, row.balance_minor, row.created_at);
    return toPlayer(row);
  }

  findByEmail(email: string): Player | null {
    const r = this.db.prepare("SELECT * FROM players WHERE email = ?").get(email.trim().toLowerCase()) as PlayerRow | undefined;
    return r ? toPlayer(r) : null;
  }

  getById(id: string): Player | null {
    const r = this.db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined;
    return r ? toPlayer(r) : null;
  }

  transactionsFor(playerId: string): PlayerTransaction[] {
    return (this.db.prepare("SELECT * FROM wallet_transactions WHERE player_id = ? ORDER BY seq DESC").all(playerId) as unknown as TxRow[]).map(toTx);
  }

  getAllPlayers(): Player[] {
    return (this.db.prepare("SELECT * FROM players ORDER BY created_at DESC").all() as unknown as PlayerRow[]).map(toPlayer);
  }

  getAllTransactions(limit = 500): PlayerTransaction[] {
    return (this.db.prepare("SELECT * FROM wallet_transactions ORDER BY seq DESC LIMIT ?").all(limit) as unknown as TxRow[]).map(toTx);
  }

  /**
   * Recent rounds for the back-office, built purely from the webhook ledger: wager =
   * debits, win = credits, a rolled-back round shows its wager reversed. Free spins have
   * credits but no debit (bet 0). Newest first.
   */
  recentRounds(opts: { limit?: number; playerId?: string } = {}): LedgerRound[] {
    const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 1000);
    const where = opts.playerId ? "WHERE t.player_id = ?" : "";
    const params: (string | number)[] = opts.playerId ? [opts.playerId, limit] : [limit];
    const rows = this.db.prepare(`
      SELECT t.round_ref, t.provider_id, t.player_id, p.email AS player_email,
             MAX(t.game_code) AS game_code, MAX(t.round_type) AS round_type, MAX(t.campaign_id) AS campaign_id,
             MAX(t.feature_ref) AS feature_ref,
             MAX(t.currency) AS currency,
             SUM(CASE WHEN t.kind = 'debit'    THEN t.amount_minor ELSE 0 END) AS debit_minor,
             SUM(CASE WHEN t.kind = 'rollback' THEN t.amount_minor ELSE 0 END) AS rollback_minor,
             SUM(CASE WHEN t.kind = 'credit'   THEN t.amount_minor ELSE 0 END) AS credit_minor,
             MIN(t.created_at) AS started_at, MAX(t.created_at) AS settled_at, MAX(t.seq) AS last_seq
      FROM wallet_transactions t LEFT JOIN players p ON p.id = t.player_id
      ${where}
      GROUP BY t.provider_id, t.round_ref
      ORDER BY last_seq DESC
      LIMIT ?`).all(...params) as unknown as Array<{
        round_ref: string; provider_id: string; player_id: string; player_email: string | null; game_code: string | null;
        round_type: RoundType | null; campaign_id: string | null; feature_ref: string | null; currency: string; debit_minor: number;
        rollback_minor: number; credit_minor: number; started_at: string; settled_at: string;
      }>;
    return rows.map((r) => ({
      roundRef: r.round_ref, providerId: r.provider_id, playerId: r.player_id, playerEmail: r.player_email,
      gameCode: r.game_code, roundType: r.round_type, campaignId: r.campaign_id, featureRef: r.feature_ref, currency: r.currency,
      bet: toMajor(r.debit_minor - r.rollback_minor), win: toMajor(r.credit_minor), rolledBack: r.rollback_minor > 0,
      startedAt: r.started_at, settledAt: r.settled_at
    }));
  }

  /**
   * Bonus groups keyed by their trigger round: how many free spins paid and their total
   * win (free spins are never debited, so there is nothing to roll back). Computed over the whole ledger, not just the recent page.
   */
  bonusSummaries(featureRefs: string[]): Map<string, BonusSummary> {
    const out = new Map<string, BonusSummary>();
    const refs = [...new Set(featureRefs)].filter(Boolean);
    for (let i = 0; i < refs.length; i += 500) {
      const chunk = refs.slice(i, i + 500);
      const rows = this.db.prepare(`
        SELECT feature_ref, COUNT(DISTINCT round_ref) AS spins, MAX(currency) AS currency,
               SUM(CASE WHEN kind = 'credit' THEN amount_minor ELSE 0 END) AS credit_minor,
               MIN(created_at) AS first_at, MAX(created_at) AS last_at
        FROM wallet_transactions
        WHERE feature_ref IN (${chunk.map(() => "?").join(",")})
        GROUP BY feature_ref`).all(...chunk) as unknown as Array<{
          feature_ref: string; spins: number; currency: string; credit_minor: number; first_at: string; last_at: string;
        }>;
      for (const r of rows) {
        out.set(r.feature_ref, {
          featureRef: r.feature_ref, payingSpins: r.spins, win: toMajor(r.credit_minor), currency: r.currency,
          firstAt: r.first_at, lastAt: r.last_at
        });
      }
    }
    return out;
  }

  /** Debit the player's balance. Rejects (no balance change) if funds are insufficient. */
  debit(args: MoneyMove): AppliedResult {
    const txType: LedgerTxType = args.txType === "FREE_ROUND_BET" ? "FREE_ROUND_BET" : "WAGER";
    return this.move("debit", txType, -1, args);
  }

  credit(args: MoneyMove): AppliedResult {
    const txType: LedgerTxType = args.txType === "FREE_ROUND_WIN" ? "FREE_ROUND_WIN" : "CREDIT";
    return this.move("credit", txType, +1, args);
  }

  /** Reverse the exact debit identified by its operatorTxRef (at most once). */
  rollback(args: { providerId?: string; idempotencyKey: string; originalOperatorTxRef: string; roundRef: string; currency?: string }): AppliedResult {
    const providerId = args.providerId ?? DEFAULT_PROVIDER;
    return inTransaction(this.db, () => {
      const replay = this.replayed(providerId, args.idempotencyKey);
      if (replay) return replay;
      const original = this.db
        .prepare("SELECT * FROM wallet_transactions WHERE operator_tx_ref = ? AND kind = 'debit'")
        .get(args.originalOperatorTxRef) as TxRow | undefined;
      if (!original) throw new Error("ORIGINAL_DEBIT_NOT_FOUND");
      const already = this.db
        .prepare("SELECT * FROM wallet_transactions WHERE reverses_tx_ref = ?")
        .get(args.originalOperatorTxRef) as TxRow | undefined;
      if (already) return { operatorTxRef: already.operator_tx_ref, balanceAfter: toMajor(already.balance_after_minor) };
      const balanceAfter = this.adjustBalance(original.player_id, original.amount_minor);
      return this.insert({
        providerId, playerId: original.player_id, kind: "rollback", txType: "ROLLBACK",
        amountMinor: original.amount_minor, currency: original.currency, roundRef: args.roundRef,
        gameCode: original.game_code, roundType: original.round_type, campaignId: original.campaign_id,
        featureRef: original.feature_ref ?? null, idempotencyKey: args.idempotencyKey, reversesTxRef: original.operator_tx_ref, balanceAfterMinor: balanceAfter
      });
    });
  }

  private move(kind: "debit" | "credit", txType: LedgerTxType, sign: 1 | -1, args: MoneyMove): AppliedResult {
    const providerId = args.providerId ?? DEFAULT_PROVIDER;
    const amountMinor = toMinor(args.amount);
    if (!Number.isFinite(amountMinor) || amountMinor < 0) throw new Error("INVALID_AMOUNT");
    return inTransaction(this.db, () => {
      const replay = this.replayed(providerId, args.idempotencyKey);
      if (replay) return replay;
      const player = this.db.prepare("SELECT balance_minor FROM players WHERE id = ?").get(args.playerId) as { balance_minor: number } | undefined;
      if (!player) throw new Error("PLAYER_NOT_FOUND");
      if (sign < 0 && player.balance_minor < amountMinor) throw new InsufficientFundsError();
      const balanceAfter = this.adjustBalance(args.playerId, sign * amountMinor);
      return this.insert({
        providerId, playerId: args.playerId, kind, txType, amountMinor, currency: args.currency, roundRef: args.roundRef,
        gameCode: args.gameCode ?? null,
        roundType: args.roundType && ROUND_TYPES.has(args.roundType) ? (args.roundType as RoundType) : null,
        campaignId: args.campaignId ?? null, featureRef: args.featureRef ?? null,
        idempotencyKey: args.idempotencyKey, reversesTxRef: null,
        balanceAfterMinor: balanceAfter
      });
    });
  }

  /** A retried call with the same key returns the original result and moves nothing. */
  private replayed(providerId: string, idempotencyKey: string): AppliedResult | null {
    const r = this.db
      .prepare("SELECT operator_tx_ref, balance_after_minor FROM wallet_transactions WHERE provider_id = ? AND idempotency_key = ?")
      .get(providerId, idempotencyKey) as { operator_tx_ref: string; balance_after_minor: number } | undefined;
    return r ? { operatorTxRef: r.operator_tx_ref, balanceAfter: toMajor(r.balance_after_minor) } : null;
  }

  private adjustBalance(playerId: string, deltaMinor: number): number {
    this.db.prepare("UPDATE players SET balance_minor = balance_minor + ? WHERE id = ?").run(deltaMinor, playerId);
    return (this.db.prepare("SELECT balance_minor FROM players WHERE id = ?").get(playerId) as { balance_minor: number }).balance_minor;
  }

  private insert(t: {
    providerId: string; playerId: string; kind: TxType; txType: LedgerTxType; amountMinor: number; currency: string;
    roundRef: string; gameCode: string | null; roundType: RoundType | null; campaignId: string | null;
    featureRef: string | null; idempotencyKey: string; reversesTxRef: string | null; balanceAfterMinor: number;
  }): AppliedResult {
    const operatorTxRef = `dop_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO wallet_transactions
        (id, provider_id, player_id, kind, tx_type, amount_minor, currency, round_ref, game_code, round_type,
         campaign_id, feature_ref, idempotency_key, operator_tx_ref, reverses_tx_ref, balance_after_minor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), t.providerId, t.playerId, t.kind, t.txType, t.amountMinor, t.currency, t.roundRef, t.gameCode,
      t.roundType, t.campaignId, t.featureRef, t.idempotencyKey, operatorTxRef, t.reversesTxRef, t.balanceAfterMinor,
      new Date().toISOString()
    );
    return { operatorTxRef, balanceAfter: toMajor(t.balanceAfterMinor) };
  }
}
