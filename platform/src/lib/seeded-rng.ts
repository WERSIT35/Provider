import { createHmac, randomBytes, webcrypto } from "node:crypto";

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

class SeededStream {
  private readonly key: Buffer;
  private counter = 0n;
  private pool: Buffer = Buffer.alloc(0);
  private poolPos = 0;
  bytesDrawn = 0;

  constructor(seed: Buffer) {
    this.key = seed;
  }

  private refill(): void {
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64LE(this.counter);
    this.counter += 1n;
    this.pool = createHmac("sha256", this.key).update(ctr).digest(); // 32 bytes
    this.poolPos = 0;
  }

  fill(view: ArrayBufferView): void {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (let i = 0; i < bytes.length; i += 1) {
      if (this.poolPos >= this.pool.length) this.refill();
      bytes[i] = this.pool[this.poolPos];
      this.poolPos += 1;
      this.bytesDrawn += 1;
    }
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

/** Fresh 32-byte server seed from the real CSPRNG (never the seeded stream). */
export function generateSeed(): Buffer {
  return randomBytes(32);
}
