import { describe, expect, it } from 'vitest';

import {
  DEV_JWT_SECRET,
  assertAuthBootPolicy,
  loadConfig,
  parseTrustedProxyCidrs,
  resolveAccessTokenExpiresIn,
  resolveJwtSecret,
  resolvePreviousJwtSecret,
} from './config.js';

describe('resolveJwtSecret (G-703)', () => {
  const strong = 'a'.repeat(48);

  it('falls back to the dev secret outside production', () => {
    expect(resolveJwtSecret('development', undefined)).toBe(DEV_JWT_SECRET);
    expect(resolveJwtSecret('test', '')).toBe(DEV_JWT_SECRET);
    expect(resolveJwtSecret('development', 'custom')).toBe('custom');
  });

  it('throws in production when the secret is missing', () => {
    expect(() => resolveJwtSecret('production', undefined)).toThrow(/JWT_SECRET is required/);
    expect(() => resolveJwtSecret('production', '   ')).toThrow(/JWT_SECRET is required/);
  });

  it('throws in production on placeholder or short secrets', () => {
    expect(() => resolveJwtSecret('production', DEV_JWT_SECRET)).toThrow(/placeholder/);
    expect(() => resolveJwtSecret('production', 'CHANGE_ME_IN_PRODUCTION')).toThrow(/placeholder/);
    expect(() => resolveJwtSecret('production', 'short-secret')).toThrow(/at least 32/);
  });

  it('accepts a strong production secret', () => {
    expect(resolveJwtSecret('production', strong)).toBe(strong);
  });
});

describe('resolveAccessTokenExpiresIn', () => {
  it('prefers the non-secret Kubernetes TTL alias', () => {
    expect(
      resolveAccessTokenExpiresIn({
        JWT_ACCESS_TTL: '20m',
        JWT_ACCESS_TOKEN_EXPIRES_IN: '10m',
      }),
    ).toBe('20m');
  });

  it('keeps the historical environment variable compatible', () => {
    expect(resolveAccessTokenExpiresIn({ JWT_ACCESS_TOKEN_EXPIRES_IN: '30m' })).toBe('30m');
    expect(resolveAccessTokenExpiresIn({})).toBe('15m');
  });
});

describe('parseTrustedProxyCidrs (W1-SEC-07)', () => {
  it('trusts no forwarding peer by default', () => {
    expect(parseTrustedProxyCidrs(undefined)).toEqual([]);
    expect(parseTrustedProxyCidrs('   ')).toEqual([]);
  });

  it('parses and de-duplicates explicit proxy IP/CIDR entries', () => {
    expect(parseTrustedProxyCidrs('10.0.0.10, 10.0.0.0/24,10.0.0.10')).toEqual([
      '10.0.0.10',
      '10.0.0.0/24',
    ]);
  });
});

describe('auth boot guards (PRC-M011)', () => {
  const strong = 'b'.repeat(48);
  it('production + JWT_SECRET_PREVIOUS=changeme throws', () => {
    expect(() => resolvePreviousJwtSecret('production', 'changeme', strong)).toThrow(/placeholder|at least/);
    expect(() => resolvePreviousJwtSecret('production', 'short', strong)).toThrow(/at least/);
    expect(() => resolvePreviousJwtSecret('production', strong, strong)).toThrow(/differ/);
    expect(resolvePreviousJwtSecret('production', 'c'.repeat(48), strong)).toBe('c'.repeat(48));
    expect(resolvePreviousJwtSecret('test', 'x', strong)).toBe('x');
    expect(resolvePreviousJwtSecret('production', undefined, strong)).toBeUndefined();
  });

  it('loadConfig refuses a weak JWT_SECRET_PREVIOUS in production', () => {
    const saved = { ...process.env };
    try {
      process.env['NODE_ENV'] = 'production';
      process.env['JWT_SECRET'] = strong;
      process.env['JWT_SECRET_PREVIOUS'] = 'changeme';
      expect(() => loadConfig()).toThrow(/JWT_SECRET_PREVIOUS/);
    } finally {
      process.env = saved;
    }
  });

  it('production without KEYCLOAK_* throws unless ALLOW_LOCAL_HS_AUTH=1', () => {
    expect(() =>
      assertAuthBootPolicy({ configEnv: 'production', keycloakConfigured: false, processEnv: {} }),
    ).toThrow(/Keycloak is not configured/);
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'production',
        keycloakConfigured: false,
        processEnv: { ALLOW_LOCAL_HS_AUTH: '1' },
      }),
    ).not.toThrow();
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'development',
        keycloakConfigured: false,
        processEnv: { APP_ENV: 'staging' },
      }),
    ).toThrow(/Keycloak is not configured/);
    expect(() =>
      assertAuthBootPolicy({ configEnv: 'test', keycloakConfigured: false, processEnv: {} }),
    ).not.toThrow();
  });

  it('refuses missing or localhost redirect / web origin in a deployed Keycloak boot', () => {
    const ok = {
      KEYCLOAK_REDIRECT_URI: 'https://api.example.edu/api/v1/auth/callback',
      NEXT_PUBLIC_WEB_URL: 'https://app.example.edu',
    };
    expect(() =>
      assertAuthBootPolicy({ configEnv: 'production', keycloakConfigured: true, processEnv: ok }),
    ).not.toThrow();
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'production',
        keycloakConfigured: true,
        processEnv: { ...ok, NEXT_PUBLIC_WEB_URL: 'http://localhost:3201' },
      }),
    ).toThrow(/NEXT_PUBLIC_WEB_URL must not point at localhost/);
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'production',
        keycloakConfigured: true,
        processEnv: { NEXT_PUBLIC_WEB_URL: ok.NEXT_PUBLIC_WEB_URL },
      }),
    ).toThrow(/KEYCLOAK_REDIRECT_URI must be set/);
  });
});
