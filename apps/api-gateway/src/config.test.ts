/**
 * Configuration loader unit tests — fail-closed production validation.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { assertProductionConfig, loadConfig, type GatewayConfig } from './config.js';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

function baseConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 3000,
    host: '0.0.0.0',
    env: 'production',
    rateLimiting: { windowMs: 60000, maxRequests: 100 },
    cors: {
      origins: ['https://app.example.com'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    jwt: {
      secret: 'a-cryptographically-random-production-secret-32b',
      issuer: 'proctira-platform',
      audience: 'proctira-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: {
      baseDomain: 'proctira.org',
      headerName: 'x-tenant-id',
    },
    services: {},
    ...overrides,
  };
}

describe('assertProductionConfig', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('is a no-op outside production', () => {
    expect(() =>
      assertProductionConfig(baseConfig({ env: 'development', jwt: { ...baseConfig().jwt, secret: 'change-me' } })),
    ).not.toThrow();
  });

  it('throws when JWT secret is missing', () => {
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';
    expect(() =>
      assertProductionConfig(baseConfig({ jwt: { ...baseConfig().jwt, secret: '' } })),
    ).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT secret is a common insecure default', () => {
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';
    for (const secret of [
      'dev-secret-change-in-production',
      'change-me',
      'change-me-in-production-please-use-a-long-random-string',
    ]) {
      expect(() =>
        assertProductionConfig(baseConfig({ jwt: { ...baseConfig().jwt, secret } })),
      ).toThrow(/JWT_SECRET/);
    }
  });

  it('throws when DATABASE_URL is missing in production', () => {
    delete process.env['DATABASE_URL'];
    expect(() => assertProductionConfig(baseConfig())).toThrow(/DATABASE_URL/);
  });

  it('accepts a strong secret with DATABASE_URL set', () => {
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';
    expect(() => assertProductionConfig(baseConfig())).not.toThrow();
  });
});

describe('loadConfig', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('allows insecure JWT defaults in development', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_SECRET'];
    delete process.env['DATABASE_URL'];

    const config = loadConfig();
    expect(config.env).toBe('development');
    expect(config.jwt.secret).toBe('dev-secret-change-in-production');
  });

  it('fails closed in production when JWT_SECRET is insecure', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'dev-secret-change-in-production';
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';

    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  it('fails closed in production when DATABASE_URL is missing', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-cryptographically-random-production-secret-32b';
    delete process.env['DATABASE_URL'];

    expect(() => loadConfig()).toThrow(/DATABASE_URL/);
  });

  it('loads production config when secrets are valid', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-cryptographically-random-production-secret-32b';
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';

    const config = loadConfig();
    expect(config.env).toBe('production');
    expect(config.jwt.secret).toBe('a-cryptographically-random-production-secret-32b');
  });
});
