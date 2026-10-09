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
      statementTimeoutMillis: PG_POOL_DEFAULTS.statementTimeoutMillis,
      queryTimeoutMillis: PG_POOL_DEFAULTS.queryTimeoutMillis,
      idleInTransactionSessionTimeoutMillis: PG_POOL_DEFAULTS.idleInTransactionSessionTimeoutMillis,
    });
  });

  it('honours statement/query/idle-in-tx timeout env vars (M541)', () => {
    const cfg = resolvePgPoolConfig({
      PG_STATEMENT_TIMEOUT_MS: '15000',
      PG_QUERY_TIMEOUT_MS: '12000',
      PG_IDLE_IN_TX_TIMEOUT_MS: '90000',
    });
    expect(cfg.statementTimeoutMillis).toBe(15_000);
    expect(cfg.queryTimeoutMillis).toBe(12_000);
    expect(cfg.idleInTransactionSessionTimeoutMillis).toBe(90_000);
    // Out-of-range values fall back to defaults (fail-closed, no unbounded statements).
    expect(resolvePgPoolConfig({ PG_STATEMENT_TIMEOUT_MS: '0' }).statementTimeoutMillis).toBe(
      PG_POOL_DEFAULTS.statementTimeoutMillis,
    );
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

  it('buildPgPoolOptions bounds every statement with server + client timeouts (M541)', () => {
    const opts = buildPgPoolOptions('postgres://localhost/proctira', {});
    expect(opts.statement_timeout).toBe(PG_POOL_DEFAULTS.statementTimeoutMillis);
    expect(opts.query_timeout).toBe(PG_POOL_DEFAULTS.queryTimeoutMillis);
    expect(opts.idle_in_transaction_session_timeout).toBe(
      PG_POOL_DEFAULTS.idleInTransactionSessionTimeoutMillis,
    );
    // No unbounded (0 / undefined) timeouts may escape the builder.
    expect(opts.statement_timeout).toBeGreaterThan(0);
    expect(opts.query_timeout).toBeGreaterThan(0);
    expect(opts.idle_in_transaction_session_timeout).toBeGreaterThan(0);
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

  it('attaches an error listener so idle-client errors do not crash the process (M541)', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/shared-pool-error-test');
    const pool = getSharedPgPool();
    expect(pool).not.toBeNull();
    // Without a listener node-pg would throw on an idle-client error event.
    expect(pool!.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pool!.emit('error', new Error('backend terminated connection'))).not.toThrow();
  });
});
