/**
 * Install route security helpers: install-token gate + bootstrap-lock status codes.
 *
 * PRC-M625: the token gate is ON by default. The plugin refuses to register without a token
 * (option or `INSTALL_TOKEN`, injected by the operator from the secret manager), every route —
 * `/status` and `/health` included — requires it, the comparison is constant-time, and repeated
 * failures from one client are throttled.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
export const INSTALL_TOKEN_HEADER = 'x-install-token';
/** Minimum accepted install-token length (PRC-M625). */
export const MIN_INSTALL_TOKEN_LENGTH = 16;
export interface InstallTokenGateOptions {
  /** Expected shared secret. Falls back to `INSTALL_TOKEN`; required (PRC-M625). */
  installToken?: string;
}
/**
 * Resolve the configured install token from plugin options or env.
 */
export function resolveInstallToken(options?: InstallTokenGateOptions): string | undefined {
  const fromOptions = options?.installToken?.trim();
  if (fromOptions) return fromOptions;
  const fromEnv = process.env.INSTALL_TOKEN?.trim();
  return fromEnv || undefined;
}
/**
 * PRC-M625: resolve the install token or refuse to start. There is no "gate disabled" mode.
 */
export function requireInstallToken(options?: InstallTokenGateOptions): string {
  const token = resolveInstallToken(options);
  if (!token) {
    throw new Error(
      'Install plugin refused to start: no install token configured (set INSTALL_TOKEN from the secret manager).',
    );
  }
  if (token.length < MIN_INSTALL_TOKEN_LENGTH) {
    throw new Error(
      `Install plugin refused to start: the install token must be at least ${MIN_INSTALL_TOKEN_LENGTH} characters.`,
    );
  }
  return token;
}
/** Constant-time token comparison (digests make the lengths equal). */
export function installTokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
/** PRC-M625: failed-attempt throttle per client address (fixed window). */
export interface InstallTokenFailureLimiter {
  /** True when the client is currently blocked. */
  isBlocked(key: string, now?: number): boolean;
  /** Record a failed attempt. */
  recordFailure(key: string, now?: number): void;
}
export function createInstallTokenFailureLimiter(
  maxFailures = 10,
  windowMs = 60_000,
  maxKeys = 10_000,
): InstallTokenFailureLimiter {
  const failures = new Map<string, { count: number; windowStart: number }>();
  const current = (key: string, now: number) => {
    const entry = failures.get(key);
    if (!entry || now - entry.windowStart >= windowMs) return undefined;
    return entry;
  };
  return {
    isBlocked(key, now = Date.now()) {
      const entry = current(key, now);
      return Boolean(entry && entry.count >= maxFailures);
    },
    recordFailure(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry) {
        entry.count += 1;
        return;
      }
      if (failures.size >= maxKeys) {
        for (const [k, v] of failures) {
          if (now - v.windowStart >= windowMs) failures.delete(k);
        }
        if (failures.size >= maxKeys) {
          const oldest = failures.keys().next().value;
          if (oldest !== undefined) failures.delete(oldest);
        }
      }
      failures.set(key, { count: 1, windowStart: now });
    },
  };
}
/**
 * Require `X-Install-Token` (PRC-M625: always; there is no disabled mode).
 * Returns true when the request may proceed.
 */
export function enforceInstallToken(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string,
  limiter?: InstallTokenFailureLimiter,
): boolean {
  const clientKey = request.ip || 'unknown';
  if (limiter?.isBlocked(clientKey)) {
    void reply.status(429).header('retry-after', '60').send({
      success: false,
      error: 'Too many failed install-token attempts. Try again later.',
    });
    return false;
  }
  const provided = request.headers[INSTALL_TOKEN_HEADER];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!expectedToken || !value || !installTokenMatches(value, expectedToken)) {
    limiter?.recordFailure(clientKey);
    void reply.status(401).send({
      success: false,
      error: 'Missing or invalid install token.',
    });
    return false;
  }
  return true;
}
/**
 * Map bootstrap-lock failures to HTTP 409 Conflict.
 */
export function statusForInstallResult(success: boolean, error?: string): number {
  if (success) return 200;
  if (error && /already finalized|bootstrap locked/i.test(error)) return 409;
  return 400;
}
