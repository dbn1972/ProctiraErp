/**
 * Unit tests for W1-SEC-07 /metrics access decisions (fail-closed production).
 */
import { describe, expect, it } from 'vitest';

import {
  assertMetricsAccessConfiguration,
  authorizeMetricsAccess,
  extractBearerToken,
  isLoopbackIp,
  normalizeClientIp,
  parseAllowlist,
  tokensMatch,
} from './metrics-access.js';

describe('normalizeClientIp / isLoopbackIp', () => {
  it('strips IPv4-mapped IPv6 prefix', () => {
    expect(normalizeClientIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('recognises loopback forms', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::1')).toBe(true);
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackIp('10.0.0.5')).toBe(false);
  });
});

describe('parseAllowlist / bearer helpers', () => {
  it('parses comma-separated IPs', () => {
    expect([...parseAllowlist(' 10.0.0.1, ::ffff:10.0.0.2 , ')]).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('extracts Bearer tokens case-insensitively', () => {
    expect(extractBearerToken('Bearer secret')).toBe('secret');
    expect(extractBearerToken('bearer secret')).toBe('secret');
    expect(extractBearerToken('Basic x')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('compares tokens in constant time for equal lengths', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
  });
});

describe('metrics production configuration (W1-SEC-07)', () => {
  it('rejects METRICS_PUBLIC=1 at production startup', () => {
    expect(() =>
      assertMetricsAccessConfiguration({
        NODE_ENV: 'production',
        METRICS_PUBLIC: '1',
      }),
    ).toThrow(/METRICS_PUBLIC=1 is forbidden/);
  });

  it('preserves the explicit public escape hatch outside production', () => {
    expect(() =>
      assertMetricsAccessConfiguration({
        NODE_ENV: 'development',
        METRICS_PUBLIC: '1',
      }),
    ).not.toThrow();
  });
});

describe('authorizeMetricsAccess (W1-SEC-07)', () => {
  it('fails closed if production public mode reaches the decision function', () => {
    expect(
      authorizeMetricsAccess({
        env: { NODE_ENV: 'production', METRICS_PUBLIC: '1' },
        clientIp: '203.0.113.9',
      }),
    ).toEqual({
      allow: false,
      statusCode: 403,
      reason: 'production_public_mode_forbidden',
    });
  });

  it('allows METRICS_PUBLIC=1 outside production for local development', () => {
    expect(
      authorizeMetricsAccess({
        env: { NODE_ENV: 'development', METRICS_PUBLIC: '1' },
        clientIp: '203.0.113.9',
      }),
    ).toEqual({ allow: true, reason: 'metrics_public_non_production' });
  });

  it('requires bearer when METRICS_BEARER_TOKEN is set', () => {
    const env = { NODE_ENV: 'production', METRICS_BEARER_TOKEN: 'scrape-secret' };
    expect(
      authorizeMetricsAccess({
        env,
        clientIp: '10.0.0.1',
        authorizationHeader: 'Bearer scrape-secret',
      }).allow,
    ).toBe(true);
    const denied = authorizeMetricsAccess({
      env,
      clientIp: '10.0.0.1',
      authorizationHeader: 'Bearer wrong',
    });
    expect(denied).toMatchObject({ allow: false, statusCode: 401 });
    const missing = authorizeMetricsAccess({ env, clientIp: '10.0.0.1' });
    expect(missing).toMatchObject({ allow: false, statusCode: 401 });
  });

  it('enforces allowlist in addition to bearer when both are set', () => {
    const env = {
      NODE_ENV: 'production',
      METRICS_BEARER_TOKEN: 'scrape-secret',
      METRICS_ALLOWLIST: '10.0.0.2',
    };
    expect(
      authorizeMetricsAccess({
        env,
        clientIp: '10.0.0.2',
        authorizationHeader: 'Bearer scrape-secret',
      }).allow,
    ).toBe(true);
    expect(
      authorizeMetricsAccess({
        env,
        clientIp: '10.0.0.9',
        authorizationHeader: 'Bearer scrape-secret',
      }),
    ).toMatchObject({ allow: false, statusCode: 403 });
  });

  it('allows allowlist-only scrapes without a bearer', () => {
    const env = { NODE_ENV: 'production', METRICS_ALLOWLIST: '10.0.0.5' };
    expect(authorizeMetricsAccess({ env, clientIp: '10.0.0.5' }).allow).toBe(true);
    expect(authorizeMetricsAccess({ env, clientIp: '10.0.0.6' })).toMatchObject({
      allow: false,
      statusCode: 403,
    });
  });

  it('fail-closed in production: remote denied, loopback allowed when unset', () => {
    const env = { NODE_ENV: 'production' };
    expect(authorizeMetricsAccess({ env, clientIp: '127.0.0.1' })).toEqual({
      allow: true,
      reason: 'production_loopback',
    });
    expect(authorizeMetricsAccess({ env, clientIp: '10.0.0.1' })).toMatchObject({
      allow: false,
      statusCode: 403,
    });
  });

  it('allows open scrapes in non-production when unset (local DX)', () => {
    expect(
      authorizeMetricsAccess({
        env: { NODE_ENV: 'development' },
        clientIp: '10.0.0.1',
      }),
    ).toEqual({ allow: true, reason: 'non_production_open' });
  });
});
