interface Bucket {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  private getBucket(key: string, maxPerMinute: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: maxPerMinute,
        maxTokens: maxPerMinute,
        refillRate: maxPerMinute / 60_000,
        lastRefill: Date.now(),
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(
      bucket.maxTokens,
      bucket.tokens + elapsed * bucket.refillRate,
    );
    bucket.lastRefill = now;
  }

  canConsume(key: string, maxPerMinute: number): boolean {
    const bucket = this.getBucket(key, maxPerMinute);
    this.refill(bucket);
    return bucket.tokens >= 1;
  }

  consume(key: string, maxPerMinute: number): boolean {
    const bucket = this.getBucket(key, maxPerMinute);
    this.refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  msUntilAvailable(key: string, maxPerMinute: number): number {
    const bucket = this.getBucket(key, maxPerMinute);
    this.refill(bucket);
    if (bucket.tokens >= 1) return 0;
    return Math.ceil((1 - bucket.tokens) / bucket.refillRate);
  }

  updateFromHeaders(key: string, maxPerMinute: number, remaining: number): void {
    const bucket = this.getBucket(key, maxPerMinute);
    bucket.tokens = Math.min(remaining, bucket.maxTokens);
    bucket.lastRefill = Date.now();
  }

  async waitForSlot(key: string, maxPerMinute: number): Promise<void> {
    const wait = this.msUntilAvailable(key, maxPerMinute);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.consume(key, maxPerMinute);
  }
}

export const LIMITS = {
  GLOBAL: 120,
  MESSAGES_PER_CHANNEL: 60,
  REACTIONS_PER_CHANNEL: 30,
  DM_CREATIONS: 10, // per hour, but we track per minute as 10/60 ≈ 0.17/min
} as const;
