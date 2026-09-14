import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  resetPersistenceWarnings,
  resolvePersistenceMode,
} from './persistence-policy';

describe('persistence policy (G-714 / P0-05 / W1-SEC-12)', () => {
  beforeEach(() => resetPersistenceWarnings());

  it('returns postgres when a database url is set', () => {
    expect(resolvePersistenceMode('x', 'postgres://db', { NODE_ENV: 'production' })).toBe(
      'postgres',
    );
  });

  it('throws in production without a database', () => {
    expect(() => resolvePersistenceMode('fees', undefined, { NODE_ENV: 'production' })).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });

  it('throws anywhere when REQUIRE_DATABASE=1', () => {
    expect(() =>
      assertInMemoryFallbackAllowed('fees', { NODE_ENV: 'test', REQUIRE_DATABASE: '1' }),
    ).toThrow(/REQUIRE_DATABASE=1/);
  });

  it('fail-closes when DATABASE_URL is set (P0-05)', () => {
    expect(() =>
      assertInMemoryFallbackAllowed('fees', {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://localhost/proctira',
      }),
    ).toThrow(/DATABASE_URL is set — refusing in-memory fallback/);
  });

  it('fail-closes resolvePersistenceMode when env carries DATABASE_URL but url arg is empty', () => {
    expect(() =>
      resolvePersistenceMode('admissions', undefined, {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://localhost/proctira',
      }),
    ).toThrow(/DATABASE_URL is set/);
  });

  it('W1-SEC-12: refuses production in-memory even when ALLOW_IN_MEMORY_IN_PRODUCTION=1', () => {
    const log = { warn: vi.fn(), error: vi.fn() };
    expect(() =>
      assertInMemoryFallbackAllowed(
        'fees',
        {
          NODE_ENV: 'production',
          ALLOW_IN_MEMORY_IN_PRODUCTION: '1',
        },
        log,
      ),
    ).toThrow(/ALLOW_IN_MEMORY_IN_PRODUCTION is disabled/);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]?.[0]).toMatch(/ALLOW_IN_MEMORY_IN_PRODUCTION is set but ignored/);
    expect(log.error.mock.calls[0]?.[0]).toMatch(/W1-SEC-12/);
  });

  it('W1-SEC-12: logs obsolete escape once per domain then still throws', () => {
    const log = { warn: vi.fn(), error: vi.fn() };
    const env = { NODE_ENV: 'production', ALLOW_IN_MEMORY_IN_PRODUCTION: 'true' };
    expect(() => assertInMemoryFallbackAllowed('fees', env, log)).toThrow(/W1-SEC-12/);
    expect(() => assertInMemoryFallbackAllowed('fees', env, log)).toThrow(/W1-SEC-12/);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('warns exactly once per domain in dev', () => {
    const log = { warn: vi.fn() };
    assertInMemoryFallbackAllowed('fees', { NODE_ENV: 'development' }, log);
    assertInMemoryFallbackAllowed('fees', { NODE_ENV: 'development' }, log);
    assertInMemoryFallbackAllowed('hostel', { NODE_ENV: 'development' }, log);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[0]?.[0]).toMatch(/fees/);
  });

  it('assertPostgresRepositoryAvailable throws when pool/repo is missing', () => {
    expect(() => assertPostgresRepositoryAvailable('notification', null)).toThrow(
      /Postgres repository is unavailable/,
    );
    expect(() =>
      assertPostgresRepositoryAvailable('fees', { query: () => undefined }),
    ).not.toThrow();
  });
});
