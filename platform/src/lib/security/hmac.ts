import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * HMAC request signing for the Operator (server-to-server) API (plan §6).
 * Signature base string: `timestamp\nMETHOD\npath\nsha256hex(body)`.
 * The operator signs with their shared secret; we recompute and compare in
 * constant time, then enforce timestamp skew + nonce uniqueness (replay guard).
 */

export interface SignatureParts {
  timestamp: string;
  method: string;
  path: string;
  rawBody: string;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function signatureBase(parts: SignatureParts): string {
  return `${parts.timestamp}\n${parts.method.toUpperCase()}\n${parts.path}\n${sha256Hex(parts.rawBody ?? "")}`;
}

export function computeSignature(secret: string, parts: SignatureParts): string {
  return createHmac("sha256", secret).update(signatureBase(parts)).digest("hex");
}

export function verifySignature(secret: string, parts: SignatureParts, presented: string): boolean {
  const expected = computeSignature(secret, parts);
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True if `timestamp` (unix seconds, as string) is within `skewSeconds` of now. */
export function withinSkew(timestamp: string, skewSeconds: number, nowMs = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts * 1000) <= skewSeconds * 1000;
}
