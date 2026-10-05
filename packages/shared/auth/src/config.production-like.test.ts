/**
 * PRC-L579: JWT secret guard is case/whitespace-insensitive and fails closed
 * for every NODE_ENV other than development/test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthConfig, isProductionLike, MIN_JWT_SECRET_LENGTH } from './config.js';

const STRONG = 'x'.repeat(32);

describe('auth config production-like guard (PRC-L579)', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['JWT_SECRET'];
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it.each(['Production', ' production ', 'PRODUCTION', 'staging', 'prod', 'qa', ''])(
    'NODE_ENV=%j without JWT_SECRET throws',
    (nodeEnv) => {
      process.env['NODE_ENV'] = nodeEnv;
      expect(() => createAuthConfig()).toThrow(/JWT_SECRET is required/);
    },
  );

  it('unset NODE_ENV without JWT_SECRET throws (closed by default)', () => {
    delete process.env['NODE_ENV'];
    expect(() => createAuthConfig()).toThrow(/JWT_SECRET is required/);
  });

  it.each(['development', 'Test', ' DEVELOPMENT '])(
    'NODE_ENV=%j may use the dev fallback',
    (nodeEnv) => {
      process.env['NODE_ENV'] = nodeEnv;
      expect(createAuthConfig().jwt.secret.length).toBeGreaterThan(0);
    },
  );

  it('rejects a short secret outside development/test', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'short-secret';
    expect(() => createAuthConfig()).toThrow(/at least 32/);
    expect(() => createAuthConfig({ jwt: { secret: 'y'.repeat(31) } as never })).toThrow(
      /at least 32/,
    );
  });

  it('counts bytes, not UTF-16 units', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'é'.repeat(16); // 32 bytes
    expect(createAuthConfig().jwt.secret).toBe('é'.repeat(16));
  });

  it('accepts a >= 32-byte secret in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = STRONG;
    expect(MIN_JWT_SECRET_LENGTH).toBe(32);
    expect(createAuthConfig().jwt.secret).toBe(STRONG);
  });

  it('isProductionLike normalises case/whitespace and defaults closed', () => {
    expect(isProductionLike('Production')).toBe(true);
    expect(isProductionLike('staging')).toBe(true);
    expect(isProductionLike(undefined)).toBe(true);
    expect(isProductionLike(' test ')).toBe(false);
    expect(isProductionLike('Development')).toBe(false);
  });
});
