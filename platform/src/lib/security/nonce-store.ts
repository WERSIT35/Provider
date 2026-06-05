/**
 * Replay guard: remembers recently-seen request nonces for a TTL window so a
 * captured signed request cannot be re-played (plan §6). In-memory here; Redis
 * (with TTL) in production for multi-instance correctness.
 */
export class NonceStore {
  private readonly seen = new Map<string, number>(); // nonce -> expiresAtMs

  constructor(private readonly ttlMs: number = 120_000) {}

  /** Returns true if the nonce is fresh (and records it); false if already seen. */
  checkAndRemember(nonce: string, nowMs = Date.now()): boolean {
    this.sweep(nowMs);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }

  private sweep(nowMs: number): void {
    if (this.seen.size < 1024) return;
    for (const [nonce, exp] of this.seen) {
      if (exp <= nowMs) this.seen.delete(nonce);
    }
  }
}
