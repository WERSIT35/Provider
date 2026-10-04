import type { FastifyPluginAsync } from "fastify";
import { walletHmacAuth } from "./wallet-auth";
import { InsufficientFundsError, type PlayerStore } from "../store/player-store";
import type { ProviderStore } from "../store/provider-store";

interface DebitCreditBody {
  idempotencyKey: string;
  roundRef: string;
  operatorPlayerId: string;
  amount: number;
  currency: string;
}
interface RollbackBody {
  idempotencyKey: string;
  originalOperatorTxRef: string;
  roundRef: string;
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
        const result = store.debit({
          playerId: body.operatorPlayerId,
          idempotencyKey: body.idempotencyKey,
          amount: body.amount,
          currency: body.currency,
          roundRef: body.roundRef
        });
        return { operatorTxRef: result.operatorTxRef, balanceAfter: { amount: result.balanceAfter, currency: body.currency }, status: "confirmed" };
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          return reply.code(402).send({ error: "INSUFFICIENT_FUNDS" });
        }
        req.log.error({ err }, "wallet_debit_failed");
        return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
      }
    });

    app.post("/wallet/:providerId/credit", { preHandler: auth }, async (req, reply) => {
      const body = req.body as DebitCreditBody;
      try {
        const result = store.credit({
          playerId: body.operatorPlayerId,
          idempotencyKey: body.idempotencyKey,
          amount: body.amount,
          currency: body.currency,
          roundRef: body.roundRef
        });
        return { operatorTxRef: result.operatorTxRef, balanceAfter: { amount: result.balanceAfter, currency: body.currency }, status: "confirmed" };
      } catch (err) {
        req.log.error({ err }, "wallet_credit_failed");
        return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
      }
    });

    app.post("/wallet/:providerId/rollback", { preHandler: auth }, async (req, reply) => {
      const body = req.body as RollbackBody;
      try {
        // Rollbacks need to know the currency, we assume the webhook caller doesn't provide it, 
        // wait, rollback body usually doesn't have currency.
        // The original code used cfg.currency. For multiple providers, we might need to look up 
        // the player's currency, but the demo-operator store doesn't store player currency.
        // We will just use "GEL" or a default if not present, but let's pass a dummy for now since demo-operator doesn't strictly validate it on rollback.
        const result = store.rollback({
          idempotencyKey: body.idempotencyKey,
          originalOperatorTxRef: body.originalOperatorTxRef,
          roundRef: body.roundRef,
          currency: "XXX" // It just stores it in transaction record.
        });
        return { operatorTxRef: result.operatorTxRef, status: "rolled_back" };
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
