import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt (node:crypto — no external deps, matching the
 * hand-rolled tokens.ts). Stored format is a single self-describing string:
 *
 *   scrypt$<N>$<saltHex>$<hashHex>
 *
 * so the work factor travels with the hash and can be raised later without a
 * migration. Verification is constant-time via timingSafeEqual.
 */

const KEYLEN = 32;
const DEFAULT_COST = 16384; // scrypt N (2^14); r=8, p=1 defaults.

export function hashPassword(password: string, cost = DEFAULT_COST): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N: cost });
  return `scrypt$${cost}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost <= 1) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2], "hex");
    expected = Buffer.from(parts[3], "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  const actual = scryptSync(password, salt, KEYLEN, { N: cost });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
