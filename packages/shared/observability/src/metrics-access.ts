/**
 * W1-SEC-07 — Application-layer guard for GET /metrics.
 *
 * Fail-closed in production: without METRICS_BEARER_TOKEN / METRICS_ALLOWLIST,
 * only loopback clients are accepted unless METRICS_PUBLIC=1 (explicit opt-out
 * for local/dev). Bearer comparison is timing-safe.
 */
import { timingSafeEqual } from 'node:crypto';

export interface MetricsAccessEnv {
  NODE_ENV?: string;
  METRICS_BEARER_TOKEN?: string;
  /** Comma-separated client IPs permitted to scrape /metrics. */
  METRICS_ALLOWLIST?: string;
  /** When `1`, skip auth (documented local/dev escape hatch). */
  METRICS_PUBLIC?: string;
}

export type MetricsAccessDecision =
  | { allow: true; reason: string }
  | { allow: false; statusCode: 401 | 403; reason: string };

/** Normalize IPv4-mapped IPv6 (`::ffff:127.0.0.1` → `127.0.0.1`). */
export function normalizeClientIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.toLowerCase().startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function isLoopbackIp(ip: string): boolean {
  const n = normalizeClientIp(ip).toLowerCase();
  return n === '127.0.0.1' || n === '::1' || n === 'localhost';
}

export function parseAllowlist(raw: string | undefined): ReadonlySet<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => normalizeClientIp(s))
      .filter(Boolean),
  );
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Decide whether a /metrics scrape is permitted.
 *
 * Precedence:
 * 1. METRICS_PUBLIC=1 → allow
 * 2. METRICS_BEARER_TOKEN set → require matching Bearer token; if
 *    METRICS_ALLOWLIST is also set, require IP membership as well
 * 3. METRICS_ALLOWLIST only → require IP membership
 * 4. production + unset → loopback only (fail closed for remote scrapers)
 * 5. non-production + unset → allow (local DX)
 */
export function authorizeMetricsAccess(opts: {
  env: MetricsAccessEnv;
  clientIp: string;
  authorizationHeader?: string;
}): MetricsAccessDecision {
  const { env, clientIp, authorizationHeader } = opts;
  const isProd = env.NODE_ENV === 'production';
  const token = env.METRICS_BEARER_TOKEN?.trim() || '';
  const allowlist = parseAllowlist(env.METRICS_ALLOWLIST);
  const ip = normalizeClientIp(clientIp);

  if (env.METRICS_PUBLIC === '1') {
    return { allow: true, reason: 'metrics_public' };
  }

  if (token) {
    const provided = extractBearerToken(authorizationHeader);
    if (!provided || !tokensMatch(token, provided)) {
      return { allow: false, statusCode: 401, reason: 'missing_or_invalid_bearer' };
    }
    if (allowlist.size > 0 && !allowlist.has(ip)) {
      return { allow: false, statusCode: 403, reason: 'ip_not_allowlisted' };
    }
    return { allow: true, reason: 'bearer_ok' };
  }

  if (allowlist.size > 0) {
    if (!allowlist.has(ip)) {
      return { allow: false, statusCode: 403, reason: 'ip_not_allowlisted' };
    }
    return { allow: true, reason: 'allowlist_ok' };
  }

  if (isProd) {
    if (isLoopbackIp(ip)) {
      return { allow: true, reason: 'production_loopback' };
    }
    return {
      allow: false,
      statusCode: 403,
      reason: 'production_requires_token_allowlist_or_loopback',
    };
  }

  return { allow: true, reason: 'non_production_open' };
}

/** Snapshot process.env for the metrics guard (testable via override). */
export function metricsAccessEnvFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): MetricsAccessEnv {
  return {
    NODE_ENV: env['NODE_ENV'],
    METRICS_BEARER_TOKEN: env['METRICS_BEARER_TOKEN'],
    METRICS_ALLOWLIST: env['METRICS_ALLOWLIST'],
    METRICS_PUBLIC: env['METRICS_PUBLIC'],
  };
}
