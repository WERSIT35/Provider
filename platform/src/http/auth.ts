import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Container } from "../container";
import { verifySignature, withinSkew } from "../lib/security/hmac";
import { verifyToken } from "../lib/tokens";
import { envelope } from "./errors";

function deny(reply: FastifyReply, req: FastifyRequest, status: number, code: string, message: string): FastifyReply {
  return reply.code(status).send(envelope(code, message, req.id));
}

function header(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Operator (server-to-server) HMAC auth: signature + skew + nonce + rate limit + tenant. */
export function operatorHmacAuth(container: Container): preHandlerHookHandler {
  return async (req, reply) => {
    const apiKeyId = header(req, "x-api-key");
    const signature = header(req, "x-signature");
    const timestamp = header(req, "x-timestamp");
    const nonce = header(req, "x-nonce");
    if (!apiKeyId || !signature || !timestamp || !nonce) {
      return deny(reply, req, 401, "UNAUTHORIZED", "missing signing headers");
    }
    if (!container.rateLimiter.allow(`op:${apiKeyId}`)) {
      return deny(reply, req, 429, "RATE_LIMITED", "rate limit exceeded");
    }
    const secret = container.mgmt.getHmacSecret(apiKeyId);
    const cred = container.mgmt.getCredential(apiKeyId);
    if (!secret || !cred) return deny(reply, req, 401, "UNAUTHORIZED", "unknown api key");
    if (!withinSkew(timestamp, container.config.hmacSkewSeconds)) {
      return deny(reply, req, 401, "TIMESTAMP_SKEW", "timestamp outside allowed skew");
    }
    if (!container.nonceStore.checkAndRemember(`${apiKeyId}:${nonce}`)) {
      return deny(reply, req, 401, "REPLAY_DETECTED", "nonce already used");
    }
    const path = new URL(req.url, "http://local").pathname;
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    if (!verifySignature(secret, { timestamp, method: req.method, path, rawBody }, signature)) {
      return deny(reply, req, 401, "SIGNATURE_INVALID", "signature mismatch");
    }
    try {
      container.mgmt.assertOperatorActive(cred.operator_id);
    } catch {
      return deny(reply, req, 403, "OPERATOR_SUSPENDED", "operator suspended");
    }
    req.operatorId = cred.operator_id;
    req.apiKeyId = apiKeyId;
  };
}

/** Admin-console auth: validate an admin session bearer token → req.adminClaims. */
export function adminBearerAuth(container: Container): preHandlerHookHandler {
  return async (req, reply) => {
    const auth = header(req, "authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return deny(reply, req, 401, "UNAUTHORIZED", "admin token required");
    }
    try {
      req.adminClaims = container.adminAuth.verify(auth.slice(7));
    } catch {
      return deny(reply, req, 401, "UNAUTHORIZED", "invalid admin token");
    }
  };
}

/** Game-client auth: validate a session bearer token. */
export function gameBearerAuth(container: Container): preHandlerHookHandler {
  return async (req, reply) => {
    const auth = header(req, "authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return deny(reply, req, 401, "UNAUTHORIZED", "missing bearer token");
    }
    try {
      const claims = verifyToken(container.config.sessionSecret, auth.slice(7)) as { session_id?: string };
      if (!claims.session_id) return deny(reply, req, 401, "SESSION_EXPIRED", "invalid session token");
      req.sessionId = claims.session_id;
    } catch {
      return deny(reply, req, 401, "SESSION_EXPIRED", "invalid session token");
    }
    if (!container.rateLimiter.allow(`sess:${req.sessionId}`)) {
      return deny(reply, req, 429, "RATE_LIMITED", "rate limit exceeded");
    }
  };
}
