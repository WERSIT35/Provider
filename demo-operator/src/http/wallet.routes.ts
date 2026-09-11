import type { FastifyPluginAsync } from "fastify";
import { walletHmacAuth } from "./wallet-auth";
import { InsufficientFundsError, type PlayerStore } from "../store/player-store";
import type { DemoOperatorConfig } from "../config";

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

/**
 * The wallet callback contract WebhookWallet calls (see
 * platform/src/modules/wallet/webhook-wallet.ts): POST {webhookUrl}/debit,
 * /credit, /rollback, /balance, HMAC-signed. This site IS the operator wallet —
 * every accepted call actually moves the player's real balance here.
 */
export default function walletRoutes(store: PlayerStore, cfg: DemoOperatorConfig): FastifyPluginAsync {
  return async (app) => {
    const auth = walletHmacAuth(cfg);

    app.post("/wallet/debit", { preHandler: auth }, async (req, reply) => {
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

    app.post("/wallet/credit", { preHandler: auth }, async (req, reply) => {
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

    app.post("/wallet/rollback", { preHandler: auth }, async (req, reply) => {
      const body = req.body as RollbackBody;
      try {
        const result = store.rollback({
          idempotencyKey: body.idempotencyKey,
          originalOperatorTxRef: body.originalOperatorTxRef,
          roundRef: body.roundRef,
          currency: cfg.currency
        });
        return { operatorTxRef: result.operatorTxRef, status: "rolled_back" };
      } catch (err) {
        req.log.error({ err }, "wallet_rollback_failed");
        return reply.code(404).send({ error: "ORIGINAL_DEBIT_NOT_FOUND" });
      }
    });

    app.post("/wallet/balance", { preHandler: auth }, async (req, reply) => {
      const body = req.body as BalanceBody;
      const player = store.getById(body.operatorPlayerId);
      if (!player) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
      return { amount: player.balance, currency: body.currency };
    });
  };
}
