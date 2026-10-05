import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { generateSeed, installSeededCrypto, withSeed, RNG_ALGO } from "../src/lib/seeded-rng";
import { chiSquare, chiSquareP, monobit, runs } from "../src/lib/rng-stats";

installSeededCrypto();
const crypto = globalThis.crypto as unknown as { getRandomValues<T extends ArrayBufferView>(v: T): T };
const draw = (seed: Buffer, n: number) => {
  const out = new Uint8Array(n);
  withSeed(seed, () => crypto.getRandomValues(out));
  return Buffer.from(out);
};
const u64le = (i: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(i)); return b; };

describe(`RNG stream (${RNG_ALGO})`, () => {
  it("matches its specification: block_i = HMAC-SHA256(seed, u64le(i)), concatenated", () => {
    const seed = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
    const want = Buffer.concat([0, 1, 2].map((i) => createHmac("sha256", seed).update(u64le(i)).digest()));
    expect(draw(seed, 96).equals(want)).toBe(true);
    // The published known-answer vector (qa/rng-certification-notes.md §3).
    expect(draw(seed, 32).toString("hex")).toBe(want.subarray(0, 32).toString("hex"));
  });

  it("is reproducible from the seed regardless of how the bytes are requested", () => {
    const seed = generateSeed();
    const whole = draw(seed, 1000);
    const parts = new Uint8Array(1000);
    withSeed(seed, () => {
      crypto.getRandomValues(parts.subarray(0, 1));
      crypto.getRandomValues(parts.subarray(1, 33));
      crypto.getRandomValues(parts.subarray(33));
    });
    expect(Buffer.from(parts).equals(whole)).toBe(true);
    expect(draw(generateSeed(), 64).equals(draw(generateSeed(), 64))).toBe(false);
  });

  it("outside withSeed the engine's crypto is the real CSPRNG, and seeding cannot nest", () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    crypto.getRandomValues(a);
    crypto.getRandomValues(b);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(() => withSeed(generateSeed(), () => withSeed(generateSeed(), () => 0))).toThrow(/no nested seeding/);
    // A throw inside a seeded draw disarms the stream (next call is unseeded again).
    expect(() => withSeed(generateSeed(), () => { throw new Error("boom"); })).toThrow("boom");
    expect(() => withSeed(generateSeed(), () => 0)).not.toThrow();
  });
});

describe("statistics used by npm run rng:stats", () => {
  it("chi-square p-values match published critical values", () => {
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(18.307, 10)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(293.248, 255)).toBeCloseTo(0.05, 2);
    expect(chiSquareP(310.457, 255)).toBeCloseTo(0.01, 2);
    expect(chiSquareP(66131, 65535)).toBeCloseTo(0.05, 2); // large-df (Wilson–Hilferty) branch
  });

  it("passes a good stream and rejects broken ones", () => {
    // A fixed seed: deterministic, so this test can never flake on an unlucky draw.
    const good = draw(Buffer.alloc(32, 7), 1 << 20);
    const freq = (bytes: Uint8Array) => { const f = new Float64Array(256); for (const b of bytes) f[b]++; return f; };
    expect(chiSquare(freq(good)).p).toBeGreaterThan(1e-4);
    expect(monobit(good).p).toBeGreaterThan(1e-4);
    expect(runs(good).p).toBeGreaterThan(1e-4);

    // Biased: one value 2% over-represented.
    const biased = Buffer.from(good);
    for (let i = 0; i < biased.length; i += 50) biased[i] = 0x41;
    expect(chiSquare(freq(biased)).p).toBeLessThan(1e-6);
    // Too many ones.
    const ones = Buffer.from(good).map((b, i) => (i % 20 === 0 ? 0xff : b));
    expect(monobit(ones).p).toBeLessThan(1e-6);
    // Balanced but alternating bits (0x55): runs catches what monobit cannot.
    const alt = Buffer.alloc(1 << 16, 0x55);
    expect(monobit(alt).p).toBeGreaterThan(0.5);
    expect(runs(alt).p).toBeLessThan(1e-6);
    // Expected-count weighting: a 60/40 coin passes against 0.6/0.4, fails against fair.
    expect(chiSquare([60_000, 40_000], [0.6, 0.4]).p).toBeGreaterThan(0.01);
    expect(chiSquare([60_000, 40_000]).p).toBeLessThan(1e-6);
  });
});
