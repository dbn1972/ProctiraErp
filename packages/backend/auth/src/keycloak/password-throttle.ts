/**
 * Failed-attempt limiter for the Keycloak ROPC `/auth/password` endpoint (PRC-H043).
 *
 * Two independent buckets are tracked:
 *  - per account (normalised username), regardless of source IP, so a
 *    distributed guess against one account still locks it;
 *  - per client IP, so one source cannot spray many accounts.
 *
 * State is in-process and bounded. With several gateway replicas each replica
 * enforces its own limit; Keycloak realm brute-force detection is the shared
 * backstop and must be enabled separately.
 */
export type PasswordThrottleOptions = {
  /** Failed attempts per account inside the window before locking. Default 5. */
  maxAccountFailures?: number;
  /** Failed attempts per IP inside the window before locking. Default 20. */
  maxIpFailures?: number;
  /** Sliding window for counting failures. Default 900s. */
  windowSeconds?: number;
  /** How long a bucket stays locked once the limit is hit. Default 900s. */
  lockSeconds?: number;
  /** Upper bound on tracked keys to keep memory bounded. Default 50_000. */
  maxTrackedKeys?: number;
  now?: () => number;
};

type Bucket = { failures: number[]; lockedUntil: number };

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class PasswordLoginThrottle {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxAccountFailures: number;
  private readonly maxIpFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly maxTrackedKeys: number;
  private readonly now: () => number;

  constructor(options: PasswordThrottleOptions = {}) {
    this.maxAccountFailures = positive(options.maxAccountFailures, 5);
    this.maxIpFailures = positive(options.maxIpFailures, 20);
    this.windowMs = positive(options.windowSeconds, 900) * 1000;
    this.lockMs = positive(options.lockSeconds, 900) * 1000;
    this.maxTrackedKeys = positive(options.maxTrackedKeys, 50_000);
    this.now = options.now ?? Date.now;
  }

  /** Check both buckets before contacting the IdP. */
  check(username: string, ip: string | undefined): ThrottleDecision {
    const now = this.now();
    let retryAfterMs = 0;
    for (const key of this.keys(username, ip)) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.lockedUntil > now) {
        retryAfterMs = Math.max(retryAfterMs, bucket.lockedUntil - now);
      }
    }
    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }
    return { allowed: true };
  }

  recordFailure(username: string, ip: string | undefined): void {
    const now = this.now();
    for (const key of this.keys(username, ip)) {
      const limit = key.startsWith('acct:') ? this.maxAccountFailures : this.maxIpFailures;
      const bucket = this.buckets.get(key) ?? { failures: [], lockedUntil: 0 };
      bucket.failures = bucket.failures.filter((at) => now - at < this.windowMs);
      bucket.failures.push(now);
      if (bucket.failures.length >= limit) {
        bucket.lockedUntil = now + this.lockMs;
        bucket.failures = [];
      }
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }
    this.evict(now);
  }

  /** Successful login clears the account bucket (IP bucket keeps counting). */
  recordSuccess(username: string): void {
    this.buckets.delete(accountKey(username));
  }

  private keys(username: string, ip: string | undefined): string[] {
    const keys = [accountKey(username)];
    if (ip) keys.push(`ip:${ip}`);
    return keys;
  }

  private evict(now: number): void {
    if (this.buckets.size <= this.maxTrackedKeys) return;
    for (const [key, bucket] of this.buckets) {
      const idle =
        bucket.lockedUntil <= now && bucket.failures.every((at) => now - at >= this.windowMs);
      if (idle) this.buckets.delete(key);
    }
    // Still over the cap: drop least-recently-updated entries (Map keeps insertion order).
    while (this.buckets.size > this.maxTrackedKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

function accountKey(username: string): string {
  return `acct:${username.trim().toLowerCase()}`;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
