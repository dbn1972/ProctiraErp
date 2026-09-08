import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertInMemoryFallbackAllowed,
  resetPersistenceWarnings,
  resolvePersistenceMode,
} from './persistence-policy';

describe('persistence policy (G-714)', () => {
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

  it('allows production fallback only with the explicit escape hatch', () => {
    expect(() =>
      assertInMemoryFallbackAllowed('fees', {
        NODE_ENV: 'production',
        ALLOW_IN_MEMORY_IN_PRODUCTION: '1',
      }),
    ).not.toThrow();
  });

  it('warns exactly once per domain in dev', () => {
    const log = { warn: vi.fn() };
    assertInMemoryFallbackAllowed('fees', { NODE_ENV: 'development' }, log);
    assertInMemoryFallbackAllowed('fees', { NODE_ENV: 'development' }, log);
    assertInMemoryFallbackAllowed('hostel', { NODE_ENV: 'development' }, log);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[0]?.[0]).toMatch(/fees/);
  });
});
