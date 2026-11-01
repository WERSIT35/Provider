import type { InMemoryPromotionsRepository, PromoWin } from "./promotions";
import { WalletDeclinedError, type WalletAdapter } from "../wallet/wallet.types";
import type { InMemoryTransactionStore } from "../wallet/transaction-store";

/**
 * Pays promotion prizes through the casino wallet (one credit per prize, tagged
 * PROMO_WIN). Safe to run again and again:
 *  - the credit's idempotency key is fixed per prize (`promo:<win id>:credit`), so a
 *    retry after a lost answer is replayed by the casino, never paid twice;
 *  - a prize is marked paid only on a confirmed credit; a decline or an unknown outcome
 *    leaves it `failed`, and the next run tries again under the same key;
 *  - one payment per prize at a time (in-flight set).
 * The ledger row (wallet_transactions, type PROMO_WIN) is written only once the casino
 * confirmed; it is never a round's win, so reconciliation leaves it out.
 */
export const promoCreditKey = (winId: string): string => `promo:${winId}:credit`;
export const promoRef = (winId: string): string => `promo_${winId}`;

export class PromoPayoutService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly promos: InMemoryPromotionsRepository,
    private readonly wallet: WalletAdapter,
    private readonly transactions: InMemoryTransactionStore
  ) {}

  /** Pay every prize not yet paid. Resolves with how many were paid / are still owed. */
  async payPending(): Promise<{ paid: number; failed: number }> {
    let paid = 0, failed = 0;
    for (const win of this.promos.unpaidWins()) {
      if ((await this.payOne(win)) === "paid") paid += 1; else failed += 1;
    }
    return { paid, failed };
  }

  async payOne(win: PromoWin): Promise<"paid" | "failed" | "busy"> {
    if (win.status === "paid") return "paid";
    if (this.inFlight.has(win.id)) return "busy";
    this.inFlight.add(win.id);
    const key = promoCreditKey(win.id);
    try {
      // A confirmed row under this key means the credit already went through
      // (e.g. the process stopped before the prize was marked paid).
      const done = this.transactions.getByKey(key);
      if (done && done.status === "confirmed") {
        this.promos.markPaid(win.id, done.operator_tx_ref ?? done.id);
        return "paid";
      }
      const res = await this.wallet.credit({ operatorId: win.operator_id }, {
        idempotencyKey: key,
        roundRef: promoRef(win.id),
        operatorPlayerId: win.operator_player_id,
        amount: win.amount,
        currency: win.currency,
        txType: "PROMO_WIN",
        promoType: win.promo_type,
        promoId: win.promo_id
      });
      this.transactions.record({
        operator_id: win.operator_id,
        session_id: `${win.promo_type}:${win.promo_id}`,
        round_ref: promoRef(win.id),
        type: "PROMO_WIN",
        amount: win.amount,
        currency: win.currency,
        idempotency_key: key,
        operator_tx_ref: res.operatorTxRef,
        status: "confirmed"
      });
      this.promos.markPaid(win.id, res.operatorTxRef);
      return "paid";
    } catch (err) {
      this.promos.markFailed(win.id, err instanceof WalletDeclinedError ? err.code : "CREDIT_OUTCOME_UNKNOWN");
      return "failed";
    } finally {
      this.inFlight.delete(win.id);
    }
  }
}
