/**
 * W1-ARCH-02 — rate-limit store policy unit tests.
 */
import { describe, expect, it } from 'vitest';

import { createRateLimitRedisClient, decideRateLimitStore } from './rate-limit-store.js';

describe('decideRateLimitStore (W1-ARCH-02)', () => {
  it('prefers Redis when REDIS_URL is set', () => {
    expect(
      decideRateLimitStore({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://redis:6379',
      }),
    ).toEqual({ mode: 'redis', redisUrl: 'redis://redis:6379' });
  });

  it('trims REDIS_URL whitespace', () => {
    expect(decideRateLimitStore({ REDIS_URL: '  redis://localhost:6379  ' })).toEqual({
      mode: 'redis',
      redisUrl: 'redis://localhost:6379',
    });
  });

  it('allows in-memory in non-production when REDIS_URL is unset', () => {
    expect(decideRateLimitStore({ NODE_ENV: 'development' })).toEqual({
      mode: 'memory',
      reason: 'REDIS_URL unset (dev/test process-local store)',
    });
    expect(decideRateLimitStore({ NODE_ENV: 'test' }).mode).toBe('memory');
  });

  it('refuses silent multi-replica memory in production without REDIS_URL', () => {
    expect(() => decideRateLimitStore({ NODE_ENV: 'production' })).toThrow(
      /REDIS_URL is required for cluster-wide rate limiting in production \(W1-ARCH-02\)/,
    );
  });

  it('allows explicit single-replica emergency memory in production', () => {
    expect(
      decideRateLimitStore({
        NODE_ENV: 'production',
        ALLOW_IN_MEMORY_RATE_LIMIT: '1',
      }),
    ).toEqual({
      mode: 'memory',
      reason: 'ALLOW_IN_MEMORY_RATE_LIMIT=1 (single-replica emergency)',
    });
  });
});

describe('createRateLimitRedisClient (W1-ARCH-02 fail-closed)', () => {
  it('fails closed when Redis is unreachable (no silent memory fallback)', async () => {
    await expect(createRateLimitRedisClient('redis://127.0.0.1:1')).rejects.toThrow(
      /REDIS_URL is set but Redis is unreachable for rate limiting \(W1-ARCH-02/,
    );
  });
});
