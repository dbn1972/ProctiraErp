/**
 * Process-local contact rate limiter (best-effort spam brake).
 *
 * Not durable across replicas — residual risk documented in the audit.
 * Prefer an edge/WAF throttle in production deployments.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function allowContactRequest(key: string, now = Date.now()): boolean {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (existing.count >= MAX_REQUESTS) {
    return false;
  }
  existing.count += 1;
  return true;
}

/** Test helper — clears in-memory buckets. */
export function resetContactRateLimitForTests(): void {
  buckets.clear();
}
