import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal signed-token util (HMAC-SHA256 over a base64url JSON payload) for launch
 * and session tokens. Dependency-free; the production system would use EdDSA JWTs
 * with a JWKS + kid (plan §6), but the verify/expiry semantics are the same.
 */

export interface TokenClaims {
  exp: number;
  [key: string]: unknown;
}

export function signToken(secret: string, claims: Record<string, unknown>, ttlSeconds: number): string {
  const payload: TokenClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T extends TokenClaims = TokenClaims>(secret: string, token: string): T {
  const dot = token.indexOf(".");
  if (dot < 0) throw new Error("TOKEN_INVALID");
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("TOKEN_INVALID");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    throw new Error("TOKEN_EXPIRED");
  }
  return payload;
}
