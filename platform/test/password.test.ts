import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/security/password";

describe("password hashing (scrypt)", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a random salt so the same password hashes differently each time", () => {
    const a = hashPassword("hunter2");
    const b = hashPassword("hunter2");
    expect(a).not.toBe(b);
    expect(verifyPassword("hunter2", a)).toBe(true);
    expect(verifyPassword("hunter2", b)).toBe(true);
  });

  it("embeds the scrypt cost in the self-describing format", () => {
    const stored = hashPassword("x");
    expect(stored.startsWith("scrypt$16384$")).toBe(true);
    expect(stored.split("$")).toHaveLength(4);
  });

  it("rejects malformed / tampered stored hashes without throwing", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$16384$zz$zz")).toBe(false);
    const stored = hashPassword("x");
    expect(verifyPassword("x", stored.slice(0, -2) + "00")).toBe(false);
  });
});
