import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP (and its RFC 4226 HOTP core) for authenticator-app 2FA.
 * Dependency-free (node:crypto only), consistent with tokens.ts. Defaults match
 * Google Authenticator / Authy / 1Password: SHA-1, 30s step, 6 digits.
 *
 * Secrets are RFC 4648 base32 (no padding) so they paste into any authenticator
 * and encode into an otpauth:// URI for QR enrollment.
 */

const DIGITS = 6;
const PERIOD = 30;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a random base32 secret (default 20 bytes = 160 bits, the RFC norm). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Current 6-digit code for a secret (mainly for tests / dev tooling). */
export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD);
  return hotp(base32Decode(secret), counter);
}

/**
 * Verify a submitted code, allowing ±`window` steps of clock drift (default ±1,
 * i.e. the previous/current/next 30s window). Constant-time per candidate.
 */
export function verifyTotp(secret: string, code: string, atMs = Date.now(), window = 1): boolean {
  const trimmed = (code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  const base = Math.floor(atMs / 1000 / PERIOD);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = hotp(key, base + offset);
    const a = Buffer.from(candidate);
    const b = Buffer.from(trimmed);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Build the otpauth:// URI an authenticator app encodes as a QR code. */
export function otpauthUri(secret: string, opts: { issuer: string; account: string }): string {
  // Key URI format: the "issuer:account" label keeps a literal colon separator;
  // each side is URL-encoded independently.
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── RFC 4226 HOTP core ────────────────────────────────────────────────────────
function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (safe-integer range is plenty for time steps).
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

// ── base32 (RFC 4648, no padding) ─────────────────────────────────────────────
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("INVALID_BASE32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
