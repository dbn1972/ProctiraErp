/**
 * PRC-M331 / PRC-M332: per-identifier throttles for anonymous registration
 * status lookups, keyed on (tenant, tracking number).
 *
 * Not keyed on client IP: portal traffic reaches the backend from the portal
 * server, so a per-IP limit here would throttle every applicant together.
 * In-process sliding windows; the gateway's global @fastify/rate-limit (Redis
 * in multi-replica deployments) remains the outer, shared limit.
 */
export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const MAX_TRACKED_KEYS = 50_000;

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Would another hit be allowed (without recording one)? */
  check(key: string): ThrottleDecision {
    const list = this.recent(key);
    if (list.length < this.max) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = list[0] ?? this.now();
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000)),
    };
  }

  /** Record a hit and return whether it was within the limit. */
  hit(key: string): ThrottleDecision {
    const decision = this.check(key);
    if (!decision.allowed) return decision;
    if (!this.hits.has(key) && this.hits.size >= MAX_TRACKED_KEYS) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    const list = this.hits.get(key) ?? [];
    list.push(this.now());
    this.hits.set(key, list);
    return decision;
  }

  count(key: string): number {
    return this.recent(key).length;
  }
}

export interface PublicThrottleConfig {
  /** Status lookups per tracking number per window (any outcome). */
  statusPerTracking: number;
  /** Failed (no-match) lookups per tracking number before lockout. */
  statusFailuresPerTracking: number;
  statusWindowMs: number;
}

export const DEFAULT_PUBLIC_THROTTLE: PublicThrottleConfig = {
  statusPerTracking: 10,
  statusFailuresPerTracking: 5,
  statusWindowMs: 15 * 60_000,
};

export class PublicRegistrationThrottle {
  readonly statusTracking: SlidingWindowLimiter;
  readonly statusFailures: SlidingWindowLimiter;

  constructor(config: Partial<PublicThrottleConfig> = {}, now?: () => number) {
    const c = { ...DEFAULT_PUBLIC_THROTTLE, ...config };
    this.statusTracking = new SlidingWindowLimiter(c.statusPerTracking, c.statusWindowMs, now);
    this.statusFailures = new SlidingWindowLimiter(
      c.statusFailuresPerTracking,
      c.statusWindowMs,
      now,
    );
  }
}
