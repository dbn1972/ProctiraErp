import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  liveTestsRequired,
  requireLiveDatabaseUrl,
  resolveLiveDatabaseUrl,
} from './live-database.js';

describe('W3-TEST-03 live-database helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolveLiveDatabaseUrl trims and returns undefined when unset', () => {
    expect(resolveLiveDatabaseUrl({})).toBeUndefined();
    expect(resolveLiveDatabaseUrl({ DATABASE_URL: '  postgres://x  ' })).toBe('postgres://x');
  });

  it('liveTestsRequired is true under CI unless ALLOW_LIVE_TEST_SKIP=1', () => {
    expect(liveTestsRequired({ CI: 'true' })).toBe(true);
    expect(liveTestsRequired({ REQUIRE_LIVE_TESTS: '1' })).toBe(true);
    expect(liveTestsRequired({ CI: 'true', ALLOW_LIVE_TEST_SKIP: '1' })).toBe(false);
    expect(liveTestsRequired({})).toBe(false);
  });

  it('requireLiveDatabaseUrl throws in CI when DATABASE_URL is missing', () => {
    expect(() =>
      requireLiveDatabaseUrl({ suite: 'demo', env: { CI: 'true' } }),
    ).toThrow(/W3-TEST-03/);
  });

  it('requireLiveDatabaseUrl warns and returns undefined when skip is allowed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = requireLiveDatabaseUrl({
      suite: 'demo',
      env: { ALLOW_LIVE_TEST_SKIP: '1' },
    });
    expect(url).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('W3-TEST-03'));
  });

  it('requireLiveDatabaseUrl returns the URL when set even in CI', () => {
    expect(
      requireLiveDatabaseUrl({
        suite: 'demo',
        env: { CI: 'true', DATABASE_URL: 'postgres://live' },
      }),
    ).toBe('postgres://live');
  });
});
