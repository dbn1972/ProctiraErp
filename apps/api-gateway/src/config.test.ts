import { describe, expect, it } from 'vitest';

import {
  DEV_JWT_SECRET,
  DEV_OVERLAY_JWT_SECRET,
  assertAuthBootPolicy,
  isDeployedEnvironment,
  loadConfig,
  parseTrustedProxyCidrs,
  resolveAccessTokenExpiresIn,
  resolveCorsOrigins,
  resolveJwtSecret,
  resolvePreviousJwtSecret,
  resolveTrustedProxyCidrs,
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

  it('throws in production on the dev overlay JWT_SECRET (PRC-L475)', () => {
    // 51 chars — long enough to pass the length gate alone; must still be
    // refused as a known placeholder if this exact dev overlay value were
    // ever applied against a production boot.
    expect(DEV_OVERLAY_JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(() => resolveJwtSecret('production', DEV_OVERLAY_JWT_SECRET)).toThrow(/placeholder/);
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

describe('resolveCorsOrigins (PRC-M524)', () => {
  it('falls back to the localhost defaults when unset outside a deployed environment', () => {
    expect(resolveCorsOrigins('development', undefined, {})).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ]);
    expect(resolveCorsOrigins('test', '   ', {})).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ]);
  });

  it('refuses an empty or wildcard list in a deployed environment', () => {
    expect(() => resolveCorsOrigins('production', undefined, {})).toThrow(/CORS_ORIGINS/);
    expect(() => resolveCorsOrigins('staging', ' , ', {})).toThrow(/CORS_ORIGINS/);
    expect(() => resolveCorsOrigins('development', '', { APP_ENV: 'staging' })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(() => resolveCorsOrigins('production', '*', {})).toThrow(/must not contain/);
  });

  it('parses a comma-separated list in any environment', () => {
    expect(resolveCorsOrigins('development', 'https://a.example,https://b.example', {})).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(resolveCorsOrigins('production', 'https://app.proctira.io', {})).toEqual([
      'https://app.proctira.io',
    ]);
  });
});

describe('resolveTrustedProxyCidrs (PRC-M524)', () => {
  it('refuses an empty list in a deployed environment', () => {
    expect(() => resolveTrustedProxyCidrs('production', undefined, {})).toThrow(
      /TRUSTED_PROXY_CIDRS/,
    );
    expect(() => resolveTrustedProxyCidrs('staging', '  ', {})).toThrow(/TRUSTED_PROXY_CIDRS/);
  });

  it('allows empty (trust no proxy) outside a deployed environment and parses lists', () => {
    expect(resolveTrustedProxyCidrs('test', undefined, {})).toEqual([]);
    expect(resolveTrustedProxyCidrs('production', '10.0.0.0/8, 10.0.0.0/8', {})).toEqual([
      '10.0.0.0/8',
    ]);
  });

  it('loadConfig refuses to boot in production without CORS_ORIGINS or TRUSTED_PROXY_CIDRS', () => {
    const saved = { ...process.env };
    try {
      process.env['NODE_ENV'] = 'production';
      process.env['JWT_SECRET'] = 'f'.repeat(48);
      delete process.env['JWT_SECRET_PREVIOUS'];
      delete process.env['CORS_ORIGINS'];
      process.env['TRUSTED_PROXY_CIDRS'] = '10.0.0.0/8';
      expect(() => loadConfig()).toThrow(/CORS_ORIGINS/);
      process.env['CORS_ORIGINS'] = 'https://app.example.edu';
      delete process.env['TRUSTED_PROXY_CIDRS'];
      expect(() => loadConfig()).toThrow(/TRUSTED_PROXY_CIDRS/);
      process.env['TRUSTED_PROXY_CIDRS'] = '10.0.0.0/8';
      const config = loadConfig();
      expect(config.cors.origins).toEqual(['https://app.example.edu']);
      expect(config.trustedProxyCidrs).toEqual(['10.0.0.0/8']);
    } finally {
      process.env = saved;
    }
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
    expect(() => resolvePreviousJwtSecret('production', 'changeme', strong)).toThrow(
      /placeholder|at least/,
    );
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
      // PRC-M524: deployed boots need explicit allow-lists.
      process.env['CORS_ORIGINS'] = 'https://app.example.edu';
      process.env['TRUSTED_PROXY_CIDRS'] = '10.0.0.0/8';
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

describe('deployed-environment predicate (PRC-L566)', () => {
  it.each([
    ['production', { APP_ENV: 'staging' }, true],
    ['development', { APP_ENV: 'staging' }, true],
    ['test', {}, false],
    [undefined, {}, true],
    ['staging', {}, true],
  ] as const)('NODE_ENV=%j env=%j -> deployed=%j', (nodeEnv, env, expected) => {
    expect(isDeployedEnvironment(nodeEnv, env)).toBe(expected);
  });

  it('development without a deployed stage is not deployed', () => {
    expect(isDeployedEnvironment('development', {})).toBe(false);
    expect(isDeployedEnvironment('development', { DEPLOY_ENV: 'prod' })).toBe(true);
  });

  it('JWT secret guards apply under NODE_ENV=staging without APP_ENV', () => {
    expect(() => resolveJwtSecret('staging', DEV_JWT_SECRET, {})).toThrow(/placeholder/);
    expect(() => resolveJwtSecret('staging', 'short-secret', {})).toThrow(/at least 32/);
    expect(() => resolveJwtSecret(undefined, undefined, {})).toThrow(/JWT_SECRET is required/);
    expect(() => resolvePreviousJwtSecret('staging', 'changeme', 'd'.repeat(48), {})).toThrow(
      /placeholder|at least/,
    );
    expect(resolveJwtSecret('test', undefined, {})).toBe(DEV_JWT_SECRET);
  });

  it('loadConfig refuses to boot under NODE_ENV=staging with a placeholder or short JWT_SECRET', () => {
    const saved = { ...process.env };
    try {
      process.env['NODE_ENV'] = 'staging';
      delete process.env['APP_ENV'];
      delete process.env['DEPLOY_ENV'];
      process.env['CORS_ORIGINS'] = 'https://app.example.edu';
      process.env['TRUSTED_PROXY_CIDRS'] = '10.0.0.0/8';
      process.env['JWT_SECRET'] = DEV_JWT_SECRET;
      expect(() => loadConfig()).toThrow(/JWT_SECRET/);
      process.env['JWT_SECRET'] = 'short-secret';
      expect(() => loadConfig()).toThrow(/JWT_SECRET/);
      process.env['JWT_SECRET'] = 'e'.repeat(48);
      expect(loadConfig().jwt.secret).toBe('e'.repeat(48));
    } finally {
      process.env = saved;
    }
  });
});

describe('auth wiring dev secrets (PRC-L284)', () => {
  const ok = {
    KEYCLOAK_REDIRECT_URI: 'https://api.example.edu/api/v1/auth/callback',
    NEXT_PUBLIC_WEB_URL: 'https://app.example.edu',
  };

  it.each([
    'proctira-gateway-dev-secret',
    'PROCTIRA-GATEWAY-DEV-SECRET',
    'changeme',
    'test-secret',
  ])('refuses KEYCLOAK_CLIENT_SECRET=%j in a deployed Keycloak boot', (secret) => {
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'production',
        keycloakConfigured: true,
        processEnv: { ...ok, KEYCLOAK_CLIENT_SECRET: secret },
      }),
    ).toThrow(/KEYCLOAK_CLIENT_SECRET/);
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'staging',
        keycloakConfigured: true,
        processEnv: { ...ok, KEYCLOAK_CLIENT_SECRET: secret },
      }),
    ).toThrow(/KEYCLOAK_CLIENT_SECRET/);
  });

  it('accepts a real client secret when deployed and any secret in development/test', () => {
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'production',
        keycloakConfigured: true,
        processEnv: { ...ok, KEYCLOAK_CLIENT_SECRET: 'q'.repeat(40) },
      }),
    ).not.toThrow();
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'test',
        keycloakConfigured: true,
        processEnv: { KEYCLOAK_CLIENT_SECRET: 'proctira-gateway-dev-secret' },
      }),
    ).not.toThrow();
  });

  it('the localhost redirect / web-origin fallbacks stay refused when deployed (PRC-M011 path)', () => {
    expect(() =>
      assertAuthBootPolicy({
        configEnv: 'staging',
        keycloakConfigured: true,
        processEnv: { KEYCLOAK_CLIENT_SECRET: 'q'.repeat(40) },
      }),
    ).toThrow(/KEYCLOAK_REDIRECT_URI must be set/);
  });
});
