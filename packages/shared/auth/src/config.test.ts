/**
 * Unit tests for auth configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createAuthConfig,
  DEFAULT_ACCESS_TOKEN_EXPIRES,
  DEFAULT_REFRESH_TOKEN_LIFETIME,
  DEFAULT_SESSION_DURATION,
  DEFAULT_SALT_ROUNDS,
  MIN_ACCESS_TOKEN_EXPIRES,
  MAX_ACCESS_TOKEN_EXPIRES,
  MIN_SESSION_DURATION,
  MAX_SESSION_DURATION,
  MAX_REFRESH_TOKEN_LIFETIME,
} from './config.js';

describe('createAuthConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default values when no overrides or env vars', () => {
    const config = createAuthConfig();

    expect(config.jwt.accessTokenExpiresIn).toBe(DEFAULT_ACCESS_TOKEN_EXPIRES);
    expect(config.refreshToken.maxLifetime).toBe(DEFAULT_REFRESH_TOKEN_LIFETIME);
    expect(config.session.duration).toBe(DEFAULT_SESSION_DURATION);
    expect(config.password.saltRounds).toBe(DEFAULT_SALT_ROUNDS);
    expect(config.lockout.maxAttempts).toBe(3);
    expect(config.lockout.windowSeconds).toBe(900);
    expect(config.lockout.durationSeconds).toBe(900);
  });

  it('should use overrides when provided', () => {
    const config = createAuthConfig({
      jwt: {
        secret: 'my-secret',
        issuer: 'my-issuer',
        audience: 'my-audience',
        accessTokenExpiresIn: 600, // 10 minutes
      },
      refreshToken: { maxLifetime: 7 * 24 * 60 * 60 }, // 7 days
      session: { duration: 3600 }, // 1 hour
      password: { saltRounds: 14 },
      lockout: { maxAttempts: 5, windowSeconds: 600, durationSeconds: 1800 },
    });

    expect(config.jwt.secret).toBe('my-secret');
    expect(config.jwt.issuer).toBe('my-issuer');
    expect(config.jwt.audience).toBe('my-audience');
    expect(config.jwt.accessTokenExpiresIn).toBe(600);
    expect(config.refreshToken.maxLifetime).toBe(7 * 24 * 60 * 60);
    expect(config.session.duration).toBe(3600);
    expect(config.password.saltRounds).toBe(14);
    expect(config.lockout.maxAttempts).toBe(5);
    expect(config.lockout.windowSeconds).toBe(600);
    expect(config.lockout.durationSeconds).toBe(1800);
  });

  it('should clamp access token expiration to minimum (5 minutes)', () => {
    const config = createAuthConfig({
      jwt: {
        secret: 'test',
        issuer: 'test',
        audience: 'test',
        accessTokenExpiresIn: 60, // 1 minute (below minimum)
      },
    });

    expect(config.jwt.accessTokenExpiresIn).toBe(MIN_ACCESS_TOKEN_EXPIRES);
  });

  it('should clamp access token expiration to maximum (24 hours)', () => {
    const config = createAuthConfig({
      jwt: {
        secret: 'test',
        issuer: 'test',
        audience: 'test',
        accessTokenExpiresIn: 100000, // above maximum
      },
    });

    expect(config.jwt.accessTokenExpiresIn).toBe(MAX_ACCESS_TOKEN_EXPIRES);
  });

  it('should clamp session duration to minimum (1 hour)', () => {
    const config = createAuthConfig({
      session: { duration: 60 }, // 1 minute (below minimum)
    });

    expect(config.session.duration).toBe(MIN_SESSION_DURATION);
  });

  it('should clamp session duration to maximum (24 hours)', () => {
    const config = createAuthConfig({
      session: { duration: 100000 }, // above maximum
    });

    expect(config.session.duration).toBe(MAX_SESSION_DURATION);
  });

  it('should cap refresh token lifetime at 30 days', () => {
    const config = createAuthConfig({
      refreshToken: { maxLifetime: 60 * 24 * 60 * 60 }, // 60 days
    });

    expect(config.refreshToken.maxLifetime).toBe(MAX_REFRESH_TOKEN_LIFETIME);
  });

  it('should read from environment variables', () => {
    process.env['JWT_SECRET'] = 'env-secret';
    process.env['JWT_ISSUER'] = 'env-issuer';
    process.env['JWT_AUDIENCE'] = 'env-audience';
    process.env['JWT_ACCESS_TOKEN_EXPIRES'] = '1800';
    process.env['REFRESH_TOKEN_MAX_LIFETIME'] = '604800';
    process.env['SESSION_DURATION'] = '14400';
    process.env['BCRYPT_SALT_ROUNDS'] = '10';

    const config = createAuthConfig();

    expect(config.jwt.secret).toBe('env-secret');
    expect(config.jwt.issuer).toBe('env-issuer');
    expect(config.jwt.audience).toBe('env-audience');
    expect(config.jwt.accessTokenExpiresIn).toBe(1800);
    expect(config.refreshToken.maxLifetime).toBe(604800);
    expect(config.session.duration).toBe(14400);
    expect(config.password.saltRounds).toBe(10);
  });

  it('should handle invalid environment variable values gracefully', () => {
    process.env['JWT_ACCESS_TOKEN_EXPIRES'] = 'not-a-number';
    process.env['SESSION_DURATION'] = '';

    const config = createAuthConfig();

    expect(config.jwt.accessTokenExpiresIn).toBe(DEFAULT_ACCESS_TOKEN_EXPIRES);
    expect(config.session.duration).toBe(DEFAULT_SESSION_DURATION);
  });

  it('should fail closed when no JWT secret is set in production', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];

    expect(() => createAuthConfig()).toThrow(/JWT_SECRET is required in production/);
  });

  it('should accept an explicit/env JWT secret in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-long-random-production-secret';

    const config = createAuthConfig();
    expect(config.jwt.secret).toBe('a-long-random-production-secret');
  });

  it('should not use the known default secret outside production', () => {
    delete process.env['NODE_ENV'];
    delete process.env['JWT_SECRET'];

    const config = createAuthConfig();
    // Dev fallback is used, and it is NOT the old guessable string.
    expect(config.jwt.secret).not.toBe('change-me-in-production');
    expect(config.jwt.secret.length).toBeGreaterThan(0);
  });
});
