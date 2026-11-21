/**
 * PRC-L329 (topic 2 — one secret per purpose): the LMS file download signing
 * key is a dedicated LMS_FILE_SIGNING_SECRET. In a deployed (production-like)
 * environment it fail-closes when the secret is missing, equals JWT_SECRET or
 * SIS_BOARD_EXPORT_SIGNING_SECRET, or is the committed dev placeholder. It must
 * NEVER fall back to JWT_SECRET, the board-export secret, or a committed
 * literal. Mirrors the board-export fix (PRC-L310).
 *
 * Failing-first on base: base `signingSecret()` falls back
 * LMS_FILE_SIGNING_SECRET ?? SIS_BOARD_EXPORT_SIGNING_SECRET ?? JWT_SECRET ??
 * 'lms-file-dev-secret-change-me', so in production with only JWT_SECRET set it
 * silently signs tokens with JWT_SECRET (secret reuse) and verifies them, and
 * the "missing" / placeholder cases also succeed instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createLmsFileDownloadToken,
  verifyLmsFileDownloadToken,
  isLmsFileSigningKeyMissingError,
  LmsFileSigningKeyMissingError,
  prepareLmsFileSigningAtStartup,
  resetDevLmsFileSigningForTests,
  type LmsFileSigningLog,
} from './lms-file-store.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const FILE_ID = 'file-abc';

const SIGNING_ENV_KEYS = [
  'NODE_ENV',
  'APP_ENV',
  'LMS_FILE_SIGNING_SECRET',
  'SIS_BOARD_EXPORT_SIGNING_SECRET',
  'JWT_SECRET',
] as const;

const saved: Record<string, string | undefined> = {};

function nullLog(): LmsFileSigningLog {
  return { warn: () => {}, error: () => {} };
}

beforeEach(() => {
  for (const key of SIGNING_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetDevLmsFileSigningForTests();
});

afterEach(() => {
  for (const key of SIGNING_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetDevLmsFileSigningForTests();
});

describe('LMS file signing secret is dedicated and fail-closed (PRC-L329)', () => {
  it('production: throws when LMS_FILE_SIGNING_SECRET is unset (no JWT/board-export/placeholder fallback)', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'jwt-secret-value-which-must-not-be-reused';
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET = 'board-export-dedicated-secret-value';

    expect(() => createLmsFileDownloadToken(TENANT, FILE_ID)).toThrow(
      LmsFileSigningKeyMissingError,
    );
    try {
      createLmsFileDownloadToken(TENANT, FILE_ID);
    } catch (err) {
      expect(isLmsFileSigningKeyMissingError(err)).toBe(true);
      expect((err as LmsFileSigningKeyMissingError).statusCode).toBe(503);
    }
  });

  it('staging (unset APP_ENV production-like) also fails closed', () => {
    process.env.NODE_ENV = 'staging';
    process.env.JWT_SECRET = 'jwt-secret-value';
    expect(() => createLmsFileDownloadToken(TENANT, FILE_ID)).toThrow(
      LmsFileSigningKeyMissingError,
    );
  });

  it('production: rejects a secret equal to JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'shared-secret-value';
    process.env.LMS_FILE_SIGNING_SECRET = 'shared-secret-value';
    expect(() => createLmsFileDownloadToken(TENANT, FILE_ID)).toThrow(/must not equal JWT_SECRET/);
  });

  it('production: rejects a secret equal to SIS_BOARD_EXPORT_SIGNING_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET = 'board-shared-secret';
    process.env.LMS_FILE_SIGNING_SECRET = 'board-shared-secret';
    expect(() => createLmsFileDownloadToken(TENANT, FILE_ID)).toThrow(
      /must not equal SIS_BOARD_EXPORT_SIGNING_SECRET/,
    );
  });

  it('production: rejects the committed dev placeholder', () => {
    process.env.NODE_ENV = 'production';
    process.env.LMS_FILE_SIGNING_SECRET = 'lms-file-dev-secret-change-me';
    expect(() => createLmsFileDownloadToken(TENANT, FILE_ID)).toThrow(
      LmsFileSigningKeyMissingError,
    );
  });

  it('production: signs and verifies with a dedicated secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.LMS_FILE_SIGNING_SECRET = 'a-dedicated-lms-file-signing-secret-value';
    const { token } = createLmsFileDownloadToken(TENANT, FILE_ID);
    expect(verifyLmsFileDownloadToken(TENANT, FILE_ID, token)).toEqual({ ok: true });
    // A token for a different tenant/file must not verify.
    expect(verifyLmsFileDownloadToken('other-tenant', FILE_ID, token).ok).toBe(false);
  });

  it('production: a token signed under JWT_SECRET does NOT verify (no JWT reuse)', () => {
    // Forge a token the way the base code would have (JWT_SECRET as the key).
    process.env.NODE_ENV = 'production';
    process.env.LMS_FILE_SIGNING_SECRET = 'a-dedicated-lms-file-signing-secret-value';
    process.env.JWT_SECRET = 'jwt-secret-value';
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const expUnix = Math.floor(Date.now() / 1000) + 300;
    const forged = `${expUnix}.${createHmac('sha256', 'jwt-secret-value')
      .update(`${TENANT}:${FILE_ID}:${expUnix}`)
      .digest('hex')}`;
    expect(verifyLmsFileDownloadToken(TENANT, FILE_ID, forged).ok).toBe(false);
  });

  it('development: uses a process-local ephemeral key and round-trips (no committed literal)', () => {
    process.env.NODE_ENV = 'development';
    const { token } = createLmsFileDownloadToken(TENANT, FILE_ID);
    expect(verifyLmsFileDownloadToken(TENANT, FILE_ID, token)).toEqual({ ok: true });
  });

  it('startup hook: production + missing secret logs an actionable error and does not throw', () => {
    process.env.NODE_ENV = 'production';
    const errors: Array<Record<string, unknown>> = [];
    const log: LmsFileSigningLog = { warn: () => {}, error: (obj) => errors.push(obj) };
    expect(() => prepareLmsFileSigningAtStartup(process.env, log)).not.toThrow();
    expect(errors.some((e) => e.event === 'lms_file_signing_key_missing')).toBe(true);
  });

  it('startup hook: development + missing secret prepares the ephemeral key (no error)', () => {
    process.env.NODE_ENV = 'development';
    expect(() => prepareLmsFileSigningAtStartup(process.env, nullLog())).not.toThrow();
    const { token } = createLmsFileDownloadToken(TENANT, FILE_ID);
    expect(verifyLmsFileDownloadToken(TENANT, FILE_ID, token)).toEqual({ ok: true });
  });
});
