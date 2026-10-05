/**
 * Dump the platform RNG stream (hmac-sha256-ctr/v1) to a binary file for an
 * external statistical battery: Dieharder, NIST SP 800-22 STS, TestU01.
 * See qa/rng-certification-notes.md §6.
 *
 * Bytes are drawn exactly as the engine draws them in production: seeds from the
 * OS CSPRNG (generateSeed), then crypto.getRandomValues while seeded (withSeed).
 * The seeds are written next to the stream so the sample can be reproduced
 * byte for byte (--replay-seeds).
 *
 *   npm run rng:dump -- --bytes 256M --out rng.bin                 # per-round seeds (default)
 *   npm run rng:dump -- --bytes 64M --mode single --out one-seed.bin
 *   npm run rng:dump -- --replay-seeds rng.bin.seeds --bytes 256M --out again.bin
 *
 * Options
 *   --bytes N            total bytes (suffix K/M/G; default 100M)
 *   --mode per-round     a fresh seed every --bytes-per-seed bytes, the production
 *                        shape: one seed per round (default)
 *   --mode single        one seed, one long stream (tests the stream function alone)
 *   --bytes-per-seed N   per-round draw size (default 1024; a typical paid round draws
 *                        a few hundred bytes, see rng_bytes_drawn on a round)
 *   --out FILE           output (default: <tmp>/rng-stream.bin)
 *   --replay-seeds FILE  reuse the seeds of an earlier dump instead of fresh ones
 *
 * Writes FILE, FILE.seeds (32-byte seeds, concatenated) and FILE.manifest.json
 * (parameters + SHA-256 of both files).
 *
 * Feeding the battery
 *   dieharder -a -g 201 -f FILE                  (raw binary file input)
 *   NIST STS:  ./assess <bits>, then choose input file FILE, binary format
 */
import { closeSync, openSync, readFileSync, writeFileSync, writeSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSeed, installSeededCrypto, withSeed, RNG_ALGO } from "../src/lib/seeded-rng";

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
async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function main(): Promise<void> {
  const total = size(arg("bytes"), 100 * 1024 ** 2);
  const mode = (arg("mode") ?? "per-round") as "per-round" | "single";
  if (mode !== "per-round" && mode !== "single") throw new Error("--mode must be per-round or single");
  const perSeed = mode === "single" ? total : size(arg("bytes-per-seed"), 1024);
  const out = arg("out") ?? join(tmpdir(), "rng-stream.bin");
  const replay = arg("replay-seeds");
  const replaySeeds = replay ? readFileSync(replay) : null;
  const seedsNeeded = Math.ceil(total / perSeed);
  if (replaySeeds && replaySeeds.length < seedsNeeded * 32) throw new Error(`--replay-seeds has ${replaySeeds.length / 32} seeds, need ${seedsNeeded}`);

  // The production path: the seeded wrapper installed as globalThis.crypto.
  installSeededCrypto();
  const crypto = globalThis.crypto as unknown as { getRandomValues<T extends ArrayBufferView>(v: T): T };

  const fd = openSync(out, "w");
  const seedFd = openSync(`${out}.seeds`, "w");
  const CHUNK = 1 << 16;
  const buf = new Uint8Array(Math.min(CHUNK, perSeed));
  const started = Date.now();
  let written = 0;
  for (let s = 0; s < seedsNeeded; s++) {
    const seed = replaySeeds ? replaySeeds.subarray(s * 32, s * 32 + 32) : generateSeed();
    writeSync(seedFd, seed);
    const want = Math.min(perSeed, total - written);
    withSeed(Buffer.from(seed), () => {
      for (let done = 0; done < want; ) {
        const n = Math.min(buf.length, want - done);
        const view = buf.subarray(0, n);
        crypto.getRandomValues(view);
        writeSync(fd, view);
        done += n;
      }
    });
    written += want;
    if (s % 20_000 === 0 && s) process.stderr.write(`  ${(written / 1024 ** 2).toFixed(0)} MiB\r`);
  }
  closeSync(fd);
  closeSync(seedFd);

  const manifest = {
    rng_algo: RNG_ALGO,
    construction: "block_i = HMAC-SHA256(key = 32-byte seed, msg = uint64_le(i)), i = 0,1,2,…; bytes = block_0 || block_1 || …",
    mode,
    bytes: total,
    bytes_per_seed: perSeed,
    seeds: seedsNeeded,
    seed_source: replaySeeds ? `replayed from ${replay}` : "node:crypto randomBytes(32) (OS CSPRNG), as in production",
    files: { stream: out, seeds: `${out}.seeds` },
    sha256: { stream: await sha256File(out), seeds: await sha256File(`${out}.seeds`) },
    generated_at: new Date().toISOString(),
    seconds: (Date.now() - started) / 1000
  };
  writeFileSync(`${out}.manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
