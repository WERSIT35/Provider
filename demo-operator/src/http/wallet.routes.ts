import type { FastifyPluginAsync } from "fastify";
import { walletHmacAuth } from "./wallet-auth";
import { DebitVoidedError, InsufficientFundsError, type PlayerStore } from "../store/player-store";
import type { ProviderStore } from "../store/provider-store";

interface DebitCreditBody {
  idempotencyKey: string;
  roundRef: string;
  operatorPlayerId: string;
  amount: number;
  currency: string;
  /** Free rounds: FREE_ROUND_BET (0.00 debit) / FREE_ROUND_WIN, with campaignId. Absent for cash. */
  txType?: string;
  campaignId?: string;
  /** Round attribution from the RGS (signed with the rest of the body). */
  gameCode?: string;
  roundType?: string;
  /** Bonus grouping: the trigger round_ref, on every free-spin move (signed with the body). */
  featureRef?: string;
}

/** The ledger fields carried by a signed debit/credit body. */
const moveFrom = (providerId: string, body: DebitCreditBody) => ({
  providerId,
  playerId: body.operatorPlayerId,
  idempotencyKey: body.idempotencyKey,
  amount: body.amount,
  currency: body.currency,
  roundRef: body.roundRef,
  txType: body.txType,
  campaignId: body.campaignId,
  gameCode: body.gameCode,
  roundType: body.roundType,
  featureRef: typeof body.featureRef === "string" && body.featureRef ? body.featureRef : undefined
});
/**
 * The debit to reverse is named by our operatorTxRef, or only by its idempotency key
 * when the provider never got our answer (a lost response). See PlayerStore.rollback.
 */
interface RollbackBody {
  idempotencyKey: string;
  originalOperatorTxRef?: string;
  originalIdempotencyKey?: string;
  roundRef: string;
  operatorPlayerId?: string;
}
interface BalanceBody {
  operatorPlayerId: string;
  currency: string;
}

export default function walletRoutes(store: PlayerStore, providerStore: ProviderStore): FastifyPluginAsync {
  return async (app) => {
    const auth = walletHmacAuth(providerStore);

    app.post("/wallet/:providerId/debit", { preHandler: auth }, async (req, reply) => {
      const body = req.body as DebitCreditBody;
      try {
        const result = store.debit(moveFrom((req.params as { providerId: string }).providerId, body));
        return { operatorTxRef: result.operatorTxRef, balanceAfter: { amount: result.balanceAfter, currency: body.currency }, status: "confirmed" };
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          return reply.code(402).send({ error: "INSUFFICIENT_FUNDS" });
        }
        // The provider already rolled this debit back (its response was lost): never apply it.
        if (err instanceof DebitVoidedError) {
          return reply.code(409).send({ error: "TRANSACTION_VOIDED" });
        }
        req.log.error({ err }, "wallet_debit_failed");
        return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
      }
    });

    app.post("/wallet/:providerId/credit", { preHandler: auth }, async (req, reply) => {
      const body = req.body as DebitCreditBody;
      try {
        const result = store.credit(moveFrom((req.params as { providerId: string }).providerId, body));
        return { operatorTxRef: result.operatorTxRef, balanceAfter: { amount: result.balanceAfter, currency: body.currency }, status: "confirmed" };
      } catch (err) {
        req.log.error({ err }, "wallet_credit_failed");
        return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
      }
    });

    app.post("/wallet/:providerId/rollback", { preHandler: auth }, async (req, reply) => {
      const body = req.body as RollbackBody;
      try {
        // The rollback row takes its amount and currency from the debit it reverses.
        const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
        const result = store.rollback({
          providerId: (req.params as { providerId: string }).providerId,
          idempotencyKey: body.idempotencyKey,
          originalOperatorTxRef: str(body.originalOperatorTxRef),
          originalIdempotencyKey: str(body.originalIdempotencyKey),
          roundRef: body.roundRef,
          operatorPlayerId: str(body.operatorPlayerId)
        });
        // voided: we never had the debit; its key is now refused.
        return { operatorTxRef: result.operatorTxRef, status: "rolled_back", ...(result.voided ? { voided: true } : {}) };
      } catch (err) {
        req.log.error({ err }, "wallet_rollback_failed");
        return reply.code(404).send({ error: "ORIGINAL_DEBIT_NOT_FOUND" });
      }
    });

    app.post("/wallet/:providerId/balance", { preHandler: auth }, async (req, reply) => {
      const body = req.body as BalanceBody;
      const player = store.getById(body.operatorPlayerId);
      if (!player) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
      return { amount: player.balance, currency: body.currency };
    });
  };
}
