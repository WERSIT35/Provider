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

/** Deterministic, key-order-independent JSON stringify for stable hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export function chainHash(prevHash: string, payloadHash: string): string {
  return sha256Hex(`${prevHash}:${payloadHash}`);
}
