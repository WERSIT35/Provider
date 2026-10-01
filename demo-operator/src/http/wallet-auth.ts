import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { verifySignature, withinSkew } from "../../../platform/src/lib/security/hmac";
import type { ProviderStore } from "../store/provider-store";

const SKEW_SECONDS = 30;

export function walletHmacAuth(providerStore: ProviderStore): preHandlerHookHandler {
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

    const providerId = (req.params as { providerId?: string }).providerId;
    if (!providerId) {
      req.log.warn({ path: req.url }, "wallet_webhook_missing_provider_id");
      return reply.code(404).send({ error: "PROVIDER_NOT_FOUND" });
    }

    const provider = providerStore.getById(providerId);
    if (!provider) {
      req.log.warn({ path: req.url, providerId }, "wallet_webhook_unknown_provider");
      return reply.code(404).send({ error: "PROVIDER_NOT_FOUND" });
    }

    const path = new URL(req.url, "http://local").pathname;
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
    if (!verifySignature(provider.webhookSecret, { timestamp: ts, method: req.method, path, rawBody }, sig)) {
      req.log.warn({ path: req.url }, "wallet_webhook_signature_invalid");
      return reply.code(401).send({ error: "SIGNATURE_INVALID" });
    }
  };
}
