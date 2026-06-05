/**
 * Token-bucket rate limiter keyed by api-key/session (plan §6). Protects against
 * the unbounded request loop the prototype allowed. In-memory here; Redis in prod.
 */
interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(perMinute: number, burst?: number) {
    this.capacity = burst ?? perMinute;
    this.refillPerMs = perMinute / 60_000;
  }

  /** Returns true if a token was available (request allowed). */
  allow(key: string, nowMs = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillMs: nowMs };
    const elapsed = nowMs - bucket.lastRefillMs;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.lastRefillMs = nowMs;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }
}
