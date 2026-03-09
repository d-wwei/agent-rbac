/**
 * Sliding window rate limiter — per-userId.
 *
 * Supports pluggable storage (in-memory default, or file-system persisted).
 */

import type { RateBucket, RateLimiterStorage, UserPermissions } from '../types.js';

// ── In-Memory Storage (default) ──────────────────────────────────

export class InMemoryRateLimiterStorage implements RateLimiterStorage {
  private readonly buckets = new Map<string, RateBucket>();

  get(userId: string): RateBucket | undefined {
    return this.buckets.get(userId);
  }

  set(userId: string, bucket: RateBucket): void {
    this.buckets.set(userId, bucket);
  }

  delete(userId: string): void {
    this.buckets.delete(userId);
  }

  *entries(): IterableIterator<[string, RateBucket]> {
    yield* this.buckets.entries();
  }
}

// ── Rate Limiter ─────────────────────────────────────────────────

export class RateLimiter {
  private readonly storage: RateLimiterStorage;
  private readonly windowMs: number;
  private lastCleanup: number;

  constructor(opts?: {
    storage?: RateLimiterStorage;
    /** Window size in ms. Default: 1 hour */
    windowMs?: number;
  }) {
    this.storage = opts?.storage ?? new InMemoryRateLimiterStorage();
    this.windowMs = opts?.windowMs ?? 60 * 60 * 1000;
    this.lastCleanup = Date.now();
  }

  /**
   * Check and record a request. Returns true if allowed, false if rate-limited.
   */
  check(userId: string, user: UserPermissions): boolean {
    if (user.rateLimit == null) return true;

    this.maybeCleanup();

    const now = Date.now();
    let bucket = this.storage.get(userId);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.storage.set(userId, bucket);
    }

    this.pruneOld(bucket, now);

    if (bucket.timestamps.length >= user.rateLimit) {
      return false;
    }

    bucket.timestamps.push(now);
    return true;
  }

  /**
   * Get remaining quota for a user. Returns null if no limit.
   */
  remaining(userId: string, rateLimit: number | null): number | null {
    if (rateLimit == null) return null;
    const bucket = this.storage.get(userId);
    if (!bucket) return rateLimit;
    this.pruneOld(bucket, Date.now());
    return Math.max(0, rateLimit - bucket.timestamps.length);
  }

  /**
   * Reset a user's rate limit bucket.
   */
  reset(userId: string): void {
    this.storage.delete(userId);
  }

  private pruneOld(bucket: RateBucket, now: number): void {
    const cutoff = now - this.windowMs;
    while (bucket.timestamps.length > 0 && bucket.timestamps[0] < cutoff) {
      bucket.timestamps.shift();
    }
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.windowMs) return;
    this.lastCleanup = now;
    const cutoff = now - this.windowMs * 2;
    for (const [key, bucket] of this.storage.entries()) {
      if (
        bucket.timestamps.length === 0 ||
        bucket.timestamps[bucket.timestamps.length - 1] < cutoff
      ) {
        this.storage.delete(key);
      }
    }
  }
}
