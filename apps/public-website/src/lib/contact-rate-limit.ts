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

/**
 * Resolve the rate-limit key from the trusted proxy chain.
 *
 * `TRUSTED_PROXY_HOPS` (default 1) is the number of proxies in front of this
 * app that append to `X-Forwarded-For` (ingress-nginx = 1; CDN + ingress = 2).
 * The client IP is the entry `hops` positions from the right, so values a
 * client prepends to XFF are ignored. `0` disables XFF and uses `X-Real-IP`.
 * The edge/WAF should enforce its own throttle as well; this is best-effort.
 */
export function readTrustedProxyHops(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : 1;
}

export function resolveClientKey(
  headers: Headers,
  trustedProxyHops: number = readTrustedProxyHops(),
): string {
  if (trustedProxyHops > 0) {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
      const hops = forwarded
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      if (hops.length > 0) {
        // Fewer entries than trusted hops: take the leftmost we have (closest to client).
        const index = Math.max(0, hops.length - trustedProxyHops);
        const ip = hops[index];
        if (ip) return ip;
      }
    }
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Test helper — clears in-memory buckets. */
export function resetContactRateLimitForTests(): void {
  buckets.clear();
}
