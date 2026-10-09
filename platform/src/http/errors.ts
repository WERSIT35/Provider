import type { FastifyReply } from "fastify";

/** Canonical error envelope (plan §4). */
export function envelope(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>
): { error: { code: string; message: string; request_id: string; details?: Record<string, unknown> } } {
  return { error: { code, message, request_id: requestId, ...(details ? { details } : {}) } };
}

/** Map a thrown domain error (Error.message is a stable code) to an HTTP response. */
const STATUS_BY_CODE: Record<string, number> = {
  DOMAIN_NOT_ALLOWED: 403,
  INVALID_DOMAIN: 422,
  // Lost-debit reconciliation: the stake's fate was unknown, so the round was voided
  // and the debit reversed; a retry of that round is refused.
  DEBIT_UNCONFIRMED: 502,
  ROUND_VOIDED: 409,
  TRANSACTION_VOIDED: 409,
  // Jurisdiction rules (src/modules/regulatory): the response carries error.details.
  SPIN_TOO_FAST: 429,
  REALITY_CHECK_REQUIRED: 409,
  FEATURE_BUY_DISABLED: 403,
  OPERATOR_SUSPENDED: 403,
  OPERATOR_NOT_FOUND: 404,
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
  // An idempotency key is single-use across the platform (round-orchestrator.ts claimKey).
  IDEMPOTENCY_KEY_CONFLICT: 409,
  // One round at a time per session (round-orchestrator.ts exclusive).
  SESSION_BUSY: 409,
  CAMPAIGN_NOT_FOUND: 404,
  GRANT_NOT_FOUND: 404,
  CAMPAIGN_NOT_ACTIVE: 409,
  FEATURE_IN_PROGRESS: 409,
  SESSION_LOCK_MISMATCH: 409,
  SESSION_LOCK_MISSING: 409
};

/** Code-shaped errors that are still internal faults, never shown to a caller. */
const INTERNAL_CODES = new Set(["ENGINE_INTEGRITY", "DUPLICATE_ROUND_REF"]);

export function sendDomainError(reply: FastifyReply, err: unknown, requestId: string): FastifyReply {
  const message = err instanceof Error ? err.message : "";
  // Only a stable domain code (UPPER_SNAKE, optionally `CODE:detail`, e.g.
  // DUPLICATE_SLUG:<slug>) is shown to the caller. Anything else is an internal failure
  // (an engine exception, a DB error) and so are the INTERNAL_CODES: the caller gets a
  // bare 500 and the detail stays in the server log, never in the response.
  const prefix = /^([A-Z][A-Z0-9_]{2,63})(?::[^\n]{0,200})?$/.exec(message)?.[1];
  if (!prefix || INTERNAL_CODES.has(prefix)) {
    reply.log.error({ err }, "internal_error");
    return reply.code(500).send(envelope("INTERNAL_ERROR", "Internal error", requestId));
  }
  const code = message;
  const status = STATUS_BY_CODE[code] ?? 400;
  // A domain error may carry machine-readable details (e.g. retry_after_ms, session stats).
  const details = err instanceof Error && "details" in err ? (err as { details?: Record<string, unknown> }).details : undefined;
  if (typeof details?.retry_after_ms === "number") reply.header("retry-after", String(Math.max(1, Math.ceil(details.retry_after_ms / 1000))));
  return reply.code(status).send(envelope(code, code, requestId, details));
}
