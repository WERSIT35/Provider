import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
// Reuse the platform's own signature verification + clock-skew check — the exact
// same functions platform/src/http/auth.ts uses to verify inbound HMAC requests —
// rather than re-implementing the scheme here. See also
// platform/test/support/mock-casino-wallet.ts, which verifies the same way.
import { verifySignature, withinSkew } from "../../../platform/src/lib/security/hmac";
import type { DemoOperatorConfig } from "../config";

const SKEW_SECONDS = 30;

/**
 * Verifies every incoming wallet webhook call (debit/credit/rollback/balance) came
 * from the platform's WebhookWallet, signed with the secret registered for THIS
 * Operator's webhook (see platform's `ManagementService.setWebhook`). Rejects
 * missing/invalid/expired signatures before any balance is ever touched.
 */
export function walletHmacAuth(cfg: DemoOperatorConfig): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ts = req.headers["x-timestamp"];
    const nonce = req.headers["x-nonce"];
    const sig = req.headers["x-signature"];
    if (typeof ts !== "string" || typeof nonce !== "string" || typeof sig !== "string") {
      req.log.warn({ path: req.url }, "wallet_webhook_missing_headers");
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (!withinSkew(ts, SKEW_SECONDS)) {
      req.log.warn({ path: req.url }, "wallet_webhook_timestamp_skew");
      return reply.code(401).send({ error: "TIMESTAMP_SKEW" });
    }
    const path = new URL(req.url, "http://local").pathname;
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
    if (!verifySignature(cfg.webhookSecret, { timestamp: ts, method: req.method, path, rawBody }, sig)) {
      req.log.warn({ path: req.url }, "wallet_webhook_signature_invalid");
      return reply.code(401).send({ error: "SIGNATURE_INVALID" });
    }
  };
}
