import { describe, it, expect } from "vitest";
import { totpCode, verifyTotp, generateTotpSecret, otpauthUri } from "../src/lib/security/totp";

// RFC 6238 Appendix B reference secret ("12345678901234567890") in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP (RFC 6238)", () => {
  // Expected values are the last 6 digits of the RFC 8-digit SHA-1 vectors
  // (truncation is modulo 10^digits, so 6 digits == last 6 of the 8-digit code).
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"]
  ];

  it("matches the RFC 6238 SHA-1 test vectors", () => {
    for (const [seconds, expected] of vectors) {
      expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(expected);
    }
  });

  it("verifies the current code and rejects a wrong one", () => {
    const now = Date.now();
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "000000", now)).toBe(false);
  });

  it("accepts codes within the ±1 step drift window and rejects beyond it", () => {
    const t = 1111111111 * 1000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, t - 30_000), t)).toBe(true); // prev step
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, t + 30_000), t)).toBe(true); // next step
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, t - 90_000), t)).toBe(false); // 3 steps away
  });

  it("rejects non-6-digit input without throwing", () => {
    expect(verifyTotp(RFC_SECRET, "12345")).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef")).toBe(false);
    expect(verifyTotp(RFC_SECRET, "")).toBe(false);
  });

  it("round-trips a freshly generated secret", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
  });

  it("builds a scannable otpauth URI", () => {
    const uri = otpauthUri(RFC_SECRET, { issuer: "Provider", account: "alice" });
    expect(uri).toContain("otpauth://totp/Provider:alice");
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=Provider");
  });
});
