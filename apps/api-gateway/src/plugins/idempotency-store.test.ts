/**
 * W1-ARCH-03 — idempotency store policy unit tests (fail-closed, no silent memory).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  assertIdempotencyRedisClient,
  resolveIdempotencyStore,
  resolveIdempotencyStoreMode,
} from './idempotency-store.js';
import type { RedisClient } from './idempotency.js';

describe('resolveIdempotencyStoreMode', () => {
  it('uses explicit memory for dev/test', () => {
    expect(
      resolveIdempotencyStoreMode({ NODE_ENV: 'development', IDEMPOTENCY_STORE: 'memory' }),
    ).toBe('memory');
    expect(resolveIdempotencyStoreMode({ NODE_ENV: 'test', IDEMPOTENCY_STORE: 'memory' })).toBe(
      'memory',
    );
  });

  it('defaults to memory when REDIS_URL unset outside production', () => {
    expect(resolveIdempotencyStoreMode({ NODE_ENV: 'test' })).toBe('memory');
    expect(resolveIdempotencyStoreMode({ NODE_ENV: 'development' })).toBe('memory');
  });

  it('selects redis when IDEMPOTENCY_STORE=redis', () => {
    expect(
      resolveIdempotencyStoreMode({
        NODE_ENV: 'test',
        IDEMPOTENCY_STORE: 'redis',
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toBe('redis');
  });

  it('selects redis when REDIS_URL is set', () => {
    expect(
      resolveIdempotencyStoreMode({ NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' }),
    ).toBe('redis');
  });

  it('requires redis in production by default', () => {
    expect(resolveIdempotencyStoreMode({ NODE_ENV: 'production' })).toBe('redis');
  });

  it('rejects memory in production without allow flag', () => {
    expect(() =>
      resolveIdempotencyStoreMode({ NODE_ENV: 'production', IDEMPOTENCY_STORE: 'memory' }),
    ).toThrow(/not allowed when NODE_ENV=production/);
  });

  it('allows memory in production only with ALLOW_IN_MEMORY_IDEMPOTENCY', () => {
    expect(
      resolveIdempotencyStoreMode({
        NODE_ENV: 'production',
        IDEMPOTENCY_STORE: 'memory',
        ALLOW_IN_MEMORY_IDEMPOTENCY: '1',
      }),
    ).toBe('memory');
  });

  it('rejects invalid IDEMPOTENCY_STORE values', () => {
    expect(() => resolveIdempotencyStoreMode({ IDEMPOTENCY_STORE: 'disk' })).toThrow(
      /invalid IDEMPOTENCY_STORE/,
    );
  });
});

describe('assertIdempotencyRedisClient', () => {
  it('throws when redis mode has no client (fail-closed)', () => {
    expect(() => assertIdempotencyRedisClient('redis', undefined)).toThrow(
      /refusing silent in-memory fallback/,
    );
  });

  it('passes when redis client is present', () => {
    const redis = {} as RedisClient;
    expect(() => assertIdempotencyRedisClient('redis', redis)).not.toThrow();
  });

  it('passes for memory mode without a client', () => {
    expect(() => assertIdempotencyRedisClient('memory', undefined)).not.toThrow();
  });
});

describe('resolveIdempotencyStore', () => {
  it('returns memory mode without constructing Redis', async () => {
    const importRedis = vi.fn(async () => {
      throw new Error('should not import redis');
    });
    const resolved = await resolveIdempotencyStore(
      { NODE_ENV: 'test', IDEMPOTENCY_STORE: 'memory' },
      importRedis,
    );
    expect(resolved).toEqual({ mode: 'memory' });
    expect(importRedis).not.toHaveBeenCalled();
  });

  it('refuses boot when redis mode has no REDIS_URL', async () => {
    await expect(
      resolveIdempotencyStore({ NODE_ENV: 'production', IDEMPOTENCY_STORE: 'redis' }),
    ).rejects.toThrow(/REDIS_URL is required/);
  });

  it('refuses boot when Redis client construction fails (no memory fallback)', async () => {
    await expect(
      resolveIdempotencyStore(
        { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379', IDEMPOTENCY_STORE: 'redis' },
        async () => {
          throw new Error('ioredis missing');
        },
      ),
    ).rejects.toThrow(/refusing in-memory fallback/);
  });

  it('returns a redis client when construction succeeds', async () => {
    const fakeClient = { get: vi.fn(), set: vi.fn(), del: vi.fn() } as RedisClient;
    const RedisCtor = vi.fn(function RedisMock() {
      return fakeClient;
    });
    const resolved = await resolveIdempotencyStore(
      { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
      async () => ({ default: RedisCtor as unknown as new (url: string) => RedisClient }),
    );
    expect(resolved.mode).toBe('redis');
    expect(resolved.redis).toBe(fakeClient);
    expect(RedisCtor).toHaveBeenCalledWith('redis://localhost:6379', expect.any(Object));
  });
});
