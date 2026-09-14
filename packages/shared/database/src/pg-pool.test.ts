import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PG_POOL_DEFAULTS,
  buildPgPoolOptions,
  closeSharedPgPools,
  getSharedPgPool,
  resolvePgPoolConfig,
} from './pg-pool';

describe('W3-D3 pg pool sizing', () => {
  afterEach(async () => {
    await closeSharedPgPools();
    vi.unstubAllEnvs();
  });

  it('apply bounded defaults when env is unset', () => {
    expect(resolvePgPoolConfig({})).toEqual(PG_POOL_DEFAULTS);
  });

  it('honours PG_POOL_MAX and DATABASE_POOL_SIZE with 1..100 clamp', () => {
    expect(resolvePgPoolConfig({ PG_POOL_MAX: '25' }).max).toBe(25);
    expect(resolvePgPoolConfig({ DATABASE_POOL_SIZE: '8' }).max).toBe(8);
    expect(resolvePgPoolConfig({ PG_POOL_MAX: '25', DATABASE_POOL_SIZE: '8' }).max).toBe(25);
    expect(resolvePgPoolConfig({ PG_POOL_MAX: '0' }).max).toBe(PG_POOL_DEFAULTS.max);
    expect(resolvePgPoolConfig({ PG_POOL_MAX: '999' }).max).toBe(PG_POOL_DEFAULTS.max);
  });

  it('honours idle and connection timeout env vars', () => {
    expect(
      resolvePgPoolConfig({
        PG_POOL_IDLE_TIMEOUT_MS: '45000',
        PG_POOL_CONNECTION_TIMEOUT_MS: '5000',
      }),
    ).toEqual({
      max: PG_POOL_DEFAULTS.max,
      idleTimeoutMillis: 45_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it('buildPgPoolOptions always sets max, idleTimeoutMillis, and connectionTimeoutMillis', () => {
    const opts = buildPgPoolOptions('postgres://localhost/proctira', {});
    expect(opts.connectionString).toBe('postgres://localhost/proctira');
    expect(opts.max).toBe(PG_POOL_DEFAULTS.max);
    expect(opts.idleTimeoutMillis).toBe(PG_POOL_DEFAULTS.idleTimeoutMillis);
    expect(opts.connectionTimeoutMillis).toBe(PG_POOL_DEFAULTS.connectionTimeoutMillis);
    expect(opts.max).toBeGreaterThan(0);
    expect(opts.idleTimeoutMillis).toBeGreaterThan(0);
    expect(opts.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it('deduplicates pools per connection string', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/shared-pool-test');
    const a = getSharedPgPool();
    const b = getSharedPgPool();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('returns null when DATABASE_URL is unset', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(getSharedPgPool()).toBeNull();
  });
});
