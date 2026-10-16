import { createHash } from "node:crypto";

/**
 * Hash-chain primitives for the immutable round + audit ledgers (plan §3.3/§3.4/§6).
 * Each appended record links to the previous via `chain_hash = H(prev_hash : payload_hash)`,
 * so any retroactive edit breaks every subsequent link and is detectable by verifyChain().
 */

export const GENESIS_HASH = "0".repeat(64);

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic, key-order-independent JSON stringify for stable hashing.
 *
 * Every stored hash depends on these exact bytes, so the output must never change.
 * Written with string concatenation (no map/join arrays) because it runs several
 * times per round; it reproduces the original `map().join()` form exactly, including
 * its quirks: an `undefined` value (in an object or array) prints `null`, and an array
 * hole prints nothing. Pinned by test/hash-chain.test.ts.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    let s = "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) s += ",";
      if (i in value) s += stableStringify(value[i]);
    }
    return s + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  let s = "{";
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) s += ",";
    s += JSON.stringify(keys[i]) + ":" + stableStringify(obj[keys[i]]);
  }
  return s + "}";
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export function chainHash(prevHash: string, payloadHash: string): string {
  return sha256Hex(`${prevHash}:${payloadHash}`);
}
