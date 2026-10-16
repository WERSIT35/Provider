import * as crypto from "node:crypto";
import { createHash, createHmac, randomBytes, webcrypto } from "node:crypto";

/**
 * Server-authoritative, reproducible RNG.
 *
 * The Banana X engine funnels ALL randomness through `globalThis.crypto.getRandomValues`
 * (see client/engine/rng.js). We install a controllable wrapper as `globalThis.crypto`
 * BEFORE the engine loads, so the engine captures it. The wrapper normally delegates to
 * the real CSPRNG, but can be "armed" with a seed to produce a deterministic byte stream.
 *
 * That makes a whole spin reproducible from a stored seed → deterministic replay, which is
 * the foundation for dispute resolution and certification (plan §5/§6/§8). The unseeded
 * `crypto.getRandomValues` in the prototype could not be replayed; this fixes that without
 * modifying the shared engine.
 *
 * Stream: HMAC-SHA256 counter mode. block_i = HMAC-SHA256(seed, u64le(i)); concatenated and
 * sliced to fill requested bytes. Deterministic, uniform, and keyed by the 32-byte seed.
 */

export const RNG_ALGO = "hmac-sha256-ctr/v1";

/**
 * HMAC-SHA256(seed, u64le(counter)) blocks, computed as RFC 2104 spells it out —
 * H((K ^ opad) || H((K ^ ipad) || m)) — with the padded keys prepared once per seed and
 * Node's one-shot hash, instead of a new Hmac object (three native calls) per 32-byte
 * block. Byte-identical to createHmac (test/seeded-rng.test.ts compares the streams).
 */
const oneShot = (crypto as unknown as { hash?: (alg: string, data: Buffer, enc: "buffer") => Buffer }).hash;

class SeededStream {
  private readonly key: Buffer;
  private counter = 0n;
  private pool: Buffer = Buffer.alloc(0);
  private poolPos = 0;
  /** ipad-key || counter, and opad-key || inner digest (one-shot path). */
  private readonly inner: Buffer | null = null;
  private readonly outer: Buffer | null = null;
  bytesDrawn = 0;

  constructor(seed: Buffer) {
    this.key = seed;
    if (oneShot) {
      // HMAC-SHA256 block size 64; a key longer than that is hashed first (RFC 2104).
      const k = seed.length > 64 ? createHash("sha256").update(seed).digest() : seed;
      this.inner = Buffer.alloc(64 + 8, 0x36);
      this.outer = Buffer.alloc(64 + 32, 0x5c);
      for (let i = 0; i < k.length; i++) {
        this.inner[i] ^= k[i];
        this.outer[i] ^= k[i];
      }
    }
  }

  private refill(): void {
    if (this.inner && this.outer && oneShot) {
      this.inner.writeBigUInt64LE(this.counter, 64);
      oneShot("sha256", this.inner, "buffer").copy(this.outer, 64);
      this.pool = oneShot("sha256", this.outer, "buffer"); // 32 bytes
    } else {
      const ctr = Buffer.alloc(8);
      ctr.writeBigUInt64LE(this.counter);
      this.pool = createHmac("sha256", this.key).update(ctr).digest(); // 32 bytes
    }
    this.counter += 1n;
    this.poolPos = 0;
  }

  fill(view: ArrayBufferView): void {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let i = 0;
    while (i < bytes.length) {
      if (this.poolPos >= this.pool.length) this.refill();
      const n = Math.min(bytes.length - i, this.pool.length - this.poolPos);
      bytes.set(this.pool.subarray(this.poolPos, this.poolPos + n), i);
      this.poolPos += n;
      i += n;
    }
    this.bytesDrawn += bytes.length;
  }
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(view: T): T;
}

class SeededCryptoController implements CryptoLike {
  private readonly real: CryptoLike;
  private stream: SeededStream | null = null;

  constructor(real: CryptoLike) {
    this.real = real;
  }

  get armed(): boolean {
    return this.stream !== null;
  }

  arm(seed: Buffer): void {
    if (this.stream) throw new Error("SeededCrypto already armed (no nested seeding).");
    this.stream = new SeededStream(seed);
  }

  /** Disarm and return the number of seeded bytes consumed (the rng_counter). */
  disarm(): number {
    const n = this.stream?.bytesDrawn ?? 0;
    this.stream = null;
    return n;
  }

  getRandomValues<T extends ArrayBufferView>(view: T): T {
    if (this.stream) {
      this.stream.fill(view);
      return view;
    }
    return this.real.getRandomValues(view);
  }
  // Intentionally NO randomUUID: the engine's uuid() then falls back to the
  // getRandomValues path, so UUIDs are also deterministic under a seed.
}

let controller: SeededCryptoController | null = null;

/** Install the wrapper as globalThis.crypto. Idempotent; must run before the engine loads. */
export function installSeededCrypto(): SeededCryptoController {
  if (controller) return controller;
  const existing = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  const real: CryptoLike = existing ?? (webcrypto as unknown as CryptoLike);
  const ctrl = new SeededCryptoController(real);
  try {
    Object.defineProperty(globalThis, "crypto", { value: ctrl, configurable: true, writable: true });
  } catch (err) {
    throw new Error(
      `Failed to install seeded crypto (cannot override globalThis.crypto): ${(err as Error).message}`
    );
  }
  controller = ctrl;
  return ctrl;
}

export function isSeededCryptoInstalled(): boolean {
  return controller !== null;
}

/** Run `fn` with the RNG seeded by `seed`; returns its result and the bytes consumed. */
export function withSeed<T>(seed: Buffer, fn: () => T): { result: T; bytesDrawn: number } {
  if (!controller) throw new Error("Seeded crypto not installed. Call installSeededCrypto() first.");
  controller.arm(seed);
  try {
    const result = fn();
    const bytesDrawn = controller.disarm();
    return { result, bytesDrawn };
  } catch (err) {
    controller.disarm();
    throw err;
  }
}

/**
 * The first `n` bytes of the stream for `seed`, computed directly (no crypto wrapper,
 * no engine): the bytes a round with that seed and rng_bytes_drawn = n consumed. The
 * round export hashes them as its random-stream proof.
 */
export function streamBytes(seed: Buffer, n: number): Buffer {
  const out = Buffer.alloc(n);
  new SeededStream(seed).fill(out);
  return out;
}

/** Fresh 32-byte server seed from the real CSPRNG (never the seeded stream). */
export function generateSeed(): Buffer {
  return randomBytes(32);
}
