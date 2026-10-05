/**
 * Internal statistical validation of the platform RNG (qa/rng-certification-notes.md §7).
 * A fast pre-lab battery, not a substitute for Dieharder / NIST STS on a
 * scripts/rng-dump.ts sample.
 *
 *   npm run rng:stats                    # default 32 MiB per stream test
 *   npm run rng:stats -- --bytes 128M --json out.json
 *
 * A. the raw byte stream, per-round seeds (production shape) and one long single-seed stream:
 *    byte frequency, byte × position-in-HMAC-block, non-overlapping byte pairs,
 *    NIST monobit, NIST runs
 * B. across seeds: the first 16 bits drawn under 1M fresh seeds
 * C. the engine's own mappings, drawn through the real client/engine/rng.js under a seed:
 *    randomInt(n) for several n, randomFloat (1000 bins), weightedPick (the multiplier table)
 * D. determinism: a known-answer vector, and replay of 1000 random seeds
 *
 * Every chi-square / NIST p-value must lie in [ALPHA, 1 − ALPHA] (ALPHA = 1e-4); the
 * upper bound also rejects a fit that is "too good". Exit code 1 on any failure.
 */
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { generateSeed, installSeededCrypto, withSeed, RNG_ALGO } from "../src/lib/seeded-rng";
import { loadSlotEngine } from "../src/lib/engine-loader";
import { chiSquare, chiSquareP, erfc, monobit, runs } from "../src/lib/rng-stats";

const ALPHA = 1e-4;
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function size(v: string | undefined, dflt: number): number {
  if (!v) return dflt;
  const m = /^(\d+)([KMG]?)$/i.exec(v.trim());
  if (!m) throw new Error(`bad size: ${v}`);
  return Number(m[1]) * ({ "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 } as Record<string, number>)[m[2].toUpperCase()];
}

installSeededCrypto();
const { ns } = loadSlotEngine(); // after the wrapper, exactly like the RGS
const crypto = globalThis.crypto as unknown as { getRandomValues<T extends ArrayBufferView>(v: T): T };

interface Row { section: string; test: string; n: string; stat: string; df: string; p: number; pass: boolean }
const rows: Row[] = [];
function record(section: string, test: string, n: number, r: { stat: number; df?: number; p: number }): void {
  const pass = Number.isFinite(r.p) && r.p >= ALPHA && r.p <= 1 - ALPHA;
  rows.push({ section, test, n: n.toLocaleString("en-US"), stat: r.stat.toFixed(2), df: r.df != null ? String(r.df) : "–", p: r.p, pass });
}
function recordBool(section: string, test: string, ok: boolean, detail: string): void {
  rows.push({ section, test, n: detail, stat: "–", df: "–", p: ok ? 1 : 0, pass: ok });
}

/** `total` bytes from the seeded stream: a fresh CSPRNG seed every `perSeed` bytes. */
function stream(total: number, perSeed: number): Uint8Array {
  const out = new Uint8Array(total);
  for (let off = 0; off < total; off += perSeed) {
    const n = Math.min(perSeed, total - off);
    withSeed(generateSeed(), () => {
      for (let d = 0; d < n; d += 65536) crypto.getRandomValues(out.subarray(off + d, off + Math.min(n, d + 65536)));
    });
  }
  return out;
}

function streamTests(section: string, bytes: Uint8Array, perSeed: number): void {
  const freq = new Float64Array(256);
  for (let i = 0; i < bytes.length; i++) freq[bytes[i]]++;
  record(section, "byte frequency", bytes.length, chiSquare(freq));

  // Byte value by position inside its 32-byte HMAC block (offset within the seed's stream).
  const pos = Array.from({ length: 32 }, () => new Float64Array(256));
  for (let i = 0; i < bytes.length; i++) pos[(i % perSeed) % 32][bytes[i]]++;
  let stat = 0;
  let df = 0;
  for (const p of pos) {
    const r = chiSquare(p);
    stat += r.stat;
    df += r.df;
  }
  record(section, "byte × position in HMAC block (32 × 256)", bytes.length, { stat, df, p: chiSquareP(stat, df) });

  const pairs = new Float64Array(65536);
  for (let i = 0; i + 1 < bytes.length; i += 2) pairs[(bytes[i] << 8) | bytes[i + 1]]++;
  record(section, "non-overlapping byte pairs (65 536 bins)", bytes.length / 2, chiSquare(pairs));
  record(section, "NIST monobit (SP 800-22 §2.1)", bytes.length * 8, monobit(bytes));
  record(section, "NIST runs (SP 800-22 §2.3)", bytes.length * 8, runs(bytes));
}

function main(): void {
  const bytes = size(arg("bytes"), 32 * 1024 ** 2);
  const t0 = Date.now();

  // A. Raw stream.
  streamTests("A1 stream, per-round seeds (1 KiB/seed)", stream(bytes, 1024), 1024);
  streamTests("A2 stream, single seed", stream(bytes, bytes), bytes);

  // B. Across seeds: the first 16 bits under each of 1M fresh seeds.
  {
    const SEEDS = 1_000_000;
    const first16 = new Float64Array(65536);
    const b = new Uint8Array(2);
    for (let s = 0; s < SEEDS; s++) withSeed(generateSeed(), () => crypto.getRandomValues(b)), first16[(b[0] << 8) | b[1]]++;
    record("B across seeds", "first 16 bits of 1M seeds (65 536 bins)", SEEDS, chiSquare(first16));
  }

  // C. The engine's mappings (client/engine/rng.js), as the RGS calls them.
  const RNG = ns.RNG as { randomInt(n: number): number; randomFloat(): number; weightedPick<T>(items: T[], w: (x: T) => number): T };
  const seeded = (draws: number, fn: () => void) => {
    for (let d = 0; d < draws; d += 1000) withSeed(generateSeed(), () => { for (let i = 0; i < Math.min(1000, draws - d); i++) fn(); });
  };
  for (const n of [2, 3, 5, 6, 7, 10, 13, 30, 100, 1000]) {
    const draws = 1_000_000;
    const c = new Float64Array(n);
    let bad = 0;
    seeded(draws, () => {
      const v = RNG.randomInt(n);
      if (!(Number.isInteger(v) && v >= 0 && v < n)) bad++;
      else c[v]++;
    });
    if (bad) recordBool("C engine mapping", `randomInt(${n}) range`, false, `${bad} out of range`);
    record("C engine mapping", `randomInt(${n}) uniformity`, draws, chiSquare(c));
  }
  {
    const draws = 2_000_000;
    const bins = new Float64Array(1000);
    let sum = 0;
    let bad = 0;
    seeded(draws, () => {
      const f = RNG.randomFloat();
      if (!(f >= 0 && f < 1)) bad++;
      bins[Math.floor(f * 1000)]++;
      sum += f;
    });
    record("C engine mapping", "randomFloat (1000 bins)", draws, chiSquare(bins));
    const mean = sum / draws;
    const z = (mean - 0.5) / Math.sqrt(1 / 12 / draws);
    record("C engine mapping", "randomFloat mean = 0.5 (z-test)", draws, { stat: z, p: erfc(Math.abs(z) / Math.SQRT2) });
    recordBool("C engine mapping", "randomFloat in [0, 1)", bad === 0, `${bad} outside`);
  }
  {
    const weights = ns.Multipliers.DEFAULT_MULTIPLIER_WEIGHTS as Record<string, number>;
    const values = Object.keys(weights).map(Number);
    const total = values.reduce((s, v) => s + weights[v], 0);
    const counts = new Float64Array(values.length);
    const index = new Map(values.map((v, i) => [v, i]));
    const draws = 5_000_000;
    seeded(draws, () => counts[index.get(ns.Multipliers.randomMultiplierValue(values, weights))!]++);
    record("C engine mapping", "weightedPick: multiplier table vs its weights", draws, chiSquare(counts, values.map((v) => weights[v] / total)));
  }

  // D. Determinism.
  {
    const seed = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
    const got = Buffer.alloc(64);
    withSeed(seed, () => crypto.getRandomValues(got));
    const ctr = (i: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(i)); return b; };
    const want = Buffer.concat([0, 1].map((i) => createHmac("sha256", seed).update(ctr(i)).digest()));
    recordBool("D determinism", "known-answer vector (blocks 0–1 = HMAC-SHA256(seed, u64le(i)))", got.equals(want), got.subarray(0, 8).toString("hex") + "…");
    let mismatches = 0;
    for (let s = 0; s < 1000; s++) {
      const sd = generateSeed();
      const a = new Uint8Array(997);
      const b = new Uint8Array(997);
      withSeed(sd, () => crypto.getRandomValues(a));
      withSeed(sd, () => { crypto.getRandomValues(b.subarray(0, 13)); crypto.getRandomValues(b.subarray(13)); });
      if (!Buffer.from(a).equals(Buffer.from(b))) mismatches++;
    }
    recordBool("D determinism", "replay: 1000 seeds reproduce their stream (any read sizes)", mismatches === 0, `${mismatches} mismatches`);
  }

  const failed = rows.filter((r) => !r.pass);
  console.log(`\nRNG validation — ${RNG_ALGO}, engine ${ns.ENGINE_VERSION}, ${new Date().toISOString()}, ${((Date.now() - t0) / 1000).toFixed(0)}s, ALPHA ${ALPHA}\n`);
  console.log("| Section | Test | n | statistic | df | p | result |");
  console.log("|---|---|---:|---:|---:|---:|---|");
  for (const r of rows) console.log(`| ${r.section} | ${r.test} | ${r.n} | ${r.stat} | ${r.df} | ${r.stat === "–" ? "–" : r.p.toFixed(4)} | ${r.pass ? "PASS" : "**FAIL**"} |`);
  const json = arg("json");
  if (json) writeFileSync(json, JSON.stringify({ rng_algo: RNG_ALGO, engine_version: ns.ENGINE_VERSION, alpha: ALPHA, bytes, rows }, null, 2));
  console.log(failed.length ? `\nrng-stats: FAIL (${failed.length})` : `\nrng-stats: PASS (${rows.length} tests)`);
  process.exit(failed.length ? 1 : 0);
}

main();
