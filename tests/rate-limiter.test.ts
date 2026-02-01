import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('allows consumption within limit', () => {
    expect(limiter.consume('test', 60)).toBe(true);
    expect(limiter.consume('test', 60)).toBe(true);
  });

  it('blocks when tokens exhausted', () => {
    // Consume all 3 tokens
    for (let i = 0; i < 3; i++) {
      expect(limiter.consume('small', 3)).toBe(true);
    }
    expect(limiter.consume('small', 3)).toBe(false);
  });

  it('refills tokens over time', () => {
    vi.useFakeTimers();

    for (let i = 0; i < 3; i++) {
      limiter.consume('refill', 3);
    }
    expect(limiter.canConsume('refill', 3)).toBe(false);

    // Advance 1 minute (full refill for 3/min)
    vi.advanceTimersByTime(60_000);
    expect(limiter.canConsume('refill', 3)).toBe(true);

    vi.useRealTimers();
  });

  it('reports ms until available', () => {
    for (let i = 0; i < 3; i++) {
      limiter.consume('wait', 3);
    }
    const ms = limiter.msUntilAvailable('wait', 3);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(20_001); // ~20s for 1 token at 3/min
  });

  it('returns 0 ms when tokens available', () => {
    expect(limiter.msUntilAvailable('fresh', 60)).toBe(0);
  });

  it('updates from response headers', () => {
    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      limiter.consume('headers', 10);
    }
    expect(limiter.canConsume('headers', 10)).toBe(false);

    // Server says we have 5 remaining
    limiter.updateFromHeaders('headers', 10, 5);
    expect(limiter.canConsume('headers', 10)).toBe(true);
  });

  it('tracks separate scopes independently', () => {
    for (let i = 0; i < 3; i++) {
      limiter.consume('scope-a', 3);
    }
    expect(limiter.canConsume('scope-a', 3)).toBe(false);
    expect(limiter.canConsume('scope-b', 3)).toBe(true);
  });

  it('waitForSlot resolves immediately when available', async () => {
    const start = Date.now();
    await limiter.waitForSlot('instant', 60);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
