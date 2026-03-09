import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../core/rate-limiter.js';
import type { UserPermissions } from '../types.js';

function makeUser(rateLimit: number | null): UserPermissions {
  return {
    userId: 'test_user',
    name: 'Test',
    topRole: 'guest',
    permissions: new Set(['message.send']),
    deny: new Set(),
    rateLimit,
    maxMode: 'ask',
  };
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    const limiter = new RateLimiter();
    const user = makeUser(3);

    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(true);
  });

  it('blocks requests exceeding limit', () => {
    const limiter = new RateLimiter();
    const user = makeUser(2);

    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(false);
  });

  it('allows unlimited requests when rateLimit is null', () => {
    const limiter = new RateLimiter();
    const user = makeUser(null);

    for (let i = 0; i < 100; i++) {
      expect(limiter.check('u1', user)).toBe(true);
    }
  });

  it('resets after window expires', () => {
    const limiter = new RateLimiter({ windowMs: 1000 });
    const user = makeUser(2);

    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(1001);

    expect(limiter.check('u1', user)).toBe(true);
  });

  it('tracks different users independently', () => {
    const limiter = new RateLimiter();
    const user = makeUser(1);

    expect(limiter.check('u1', user)).toBe(true);
    expect(limiter.check('u1', user)).toBe(false);
    // u2 has its own bucket
    expect(limiter.check('u2', user)).toBe(true);
  });

  it('returns remaining quota', () => {
    const limiter = new RateLimiter();
    const user = makeUser(5);

    expect(limiter.remaining('u1', 5)).toBe(5);
    limiter.check('u1', user);
    limiter.check('u1', user);
    expect(limiter.remaining('u1', 5)).toBe(3);
  });

  it('returns null remaining for unlimited users', () => {
    const limiter = new RateLimiter();
    expect(limiter.remaining('u1', null)).toBeNull();
  });

  it('resets a user bucket', () => {
    const limiter = new RateLimiter();
    const user = makeUser(2);

    limiter.check('u1', user);
    limiter.check('u1', user);
    expect(limiter.check('u1', user)).toBe(false);

    limiter.reset('u1');
    expect(limiter.check('u1', user)).toBe(true);
  });

  it('cleans up stale buckets after 2x window', () => {
    const limiter = new RateLimiter({ windowMs: 1000 });
    const user = makeUser(10);

    limiter.check('u1', user);

    // Advance past 2x window to trigger cleanup
    vi.advanceTimersByTime(2001);
    // Next check triggers cleanup
    limiter.check('u2', user);

    // u1 bucket should have been cleaned up, so remaining should be full
    expect(limiter.remaining('u1', 10)).toBe(10);
  });
});
