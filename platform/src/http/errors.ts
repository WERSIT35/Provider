import type { FastifyReply } from "fastify";

/** Canonical error envelope (plan §4). */
export function envelope(code: string, message: string, requestId: string): { error: { code: string; message: string; request_id: string } } {
  return { error: { code, message, request_id: requestId } };
}

/** Map a thrown domain error (Error.message is a stable code) to an HTTP response. */
const STATUS_BY_CODE: Record<string, number> = {
  DOMAIN_NOT_ALLOWED: 403,
  OPERATOR_SUSPENDED: 403,
  GAME_NOT_ASSIGNED: 404,
  GAME_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 401,
  SESSION_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_EXPIRED: 401,
  INVALID_BET: 400,
  INSUFFICIENT_FUNDS: 402,
  CONFIG_NOT_APPROVED: 409,
  OPERATOR_GAME_NOT_FOUND: 404,
  WEBHOOK_NOT_CONFIGURED: 502,
  WEBHOOK_CALL_FAILED: 502,
  REQUEST_IN_PROGRESS: 409,
  CAMPAIGN_NOT_FOUND: 404,
  CAMPAIGN_NOT_ACTIVE: 409,
  FEATURE_IN_PROGRESS: 409,
  SESSION_LOCK_MISMATCH: 409,
  SESSION_LOCK_MISSING: 409
};

export function sendDomainError(reply: FastifyReply, err: unknown, requestId: string): FastifyReply {
  const code = err instanceof Error ? err.message : "INTERNAL_ERROR";
  const status = STATUS_BY_CODE[code] ?? 400;
  return reply.code(status).send(envelope(code, code, requestId));
}
