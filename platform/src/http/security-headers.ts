import type { FastifyInstance } from "fastify";

/**
 * Baseline security headers on every response, plus safe JSON parsing.
 *
 * - Everything: nosniff, a strict referrer policy, and HSTS (browsers ignore HSTS on
 *   plain http, so local dev is unaffected; behind Caddy every response is https).
 * - HTML pages that set no framing policy of their own get `frame-ancestors 'none'`.
 *   /play sets its own (the launching casino's hosts, play-page.ts) and is left alone;
 *   the admin consoles (/provider, /admin) and everything else can never be framed
 *   (clickjacking an admin into a click).
 * - API JSON is never cached by a browser or a shared proxy.
 */
export function installSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.startsWith("text/html") && !reply.hasHeader("content-security-policy")) {
      reply.header("content-security-policy", "frame-ancestors 'none'");
      reply.header("x-frame-options", "DENY");
    }
    if (type.startsWith("application/json") && !reply.hasHeader("cache-control")) {
      reply.header("cache-control", "no-store");
    }
    return payload;
  });
}

/**
 * JSON.parse that refuses prototype-poisoning keys. The app keeps the raw body for HMAC
 * verification, so it parses JSON itself and does not get Fastify's built-in
 * protection: a body like {"__proto__": {...}} or {"constructor": {"prototype": ...}}
 * is refused (400) before any handler sees it.
 */
export function safeJsonParse(raw: string): unknown {
  return JSON.parse(raw, (key, value) => {
    if (key === "__proto__") throw new SyntaxError("forbidden key: __proto__");
    if (key === "constructor" && value && typeof value === "object" && "prototype" in value) {
      throw new SyntaxError("forbidden key: constructor.prototype");
    }
    return value;
  });
}

/** Largest request body the RGS accepts (every real body is well under 1 KB). */
export const BODY_LIMIT_BYTES = 64 * 1024;
