/**
 * PRC-L337 (topic 2): the report download signing secret must be dedicated
 * (REPORT_DOWNLOAD_SIGNING_SECRET), fail-closed in a deployed environment, and
 * never fall back to SIS_BOARD_EXPORT_SIGNING_SECRET / JWT_SECRET / a committed
 * literal. The download token must also bind the requesting actor so a link
 * minted for one user cannot be replayed by another.
 *
 * These are failing-first against the base source, where signingSecret() falls
 * back to JWT_SECRET/placeholder and the token binds only tenant:artifact:exp.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ReportDownloadSigningKeyMissingError,
  createReportDownloadToken,
  isReportDownloadSigningKeyMissingError,
  resetDevReportDownloadSigningForTests,
  verifyReportDownloadToken,
} from './signed-download.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_A = 'actor-a';
const ACTOR_B = 'actor-b';
const ARTIFACT = 'artifact-1';

const SAVED = { ...process.env };

function setEnv(env: Record<string, string | undefined>): void {
  for (const key of [
    'NODE_ENV',
    'REPORT_DOWNLOAD_SIGNING_SECRET',
    'SIS_BOARD_EXPORT_SIGNING_SECRET',
    'JWT_SECRET',
  ]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  resetDevReportDownloadSigningForTests();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, SAVED);
  resetDevReportDownloadSigningForTests();
});

describe('report download signing secret (PRC-L337)', () => {
  it('fail-closes in a deployed env when the dedicated secret is unset', () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: 'jwt-value' });
    let caught: unknown;
    try {
      createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReportDownloadSigningKeyMissingError);
    expect(isReportDownloadSigningKeyMissingError(caught)).toBe(true);
  });

  it('fail-closes in a deployed env when the secret equals JWT_SECRET', () => {
    setEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'shared-value',
      REPORT_DOWNLOAD_SIGNING_SECRET: 'shared-value',
    });
    expect(() => createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A)).toThrow(
      ReportDownloadSigningKeyMissingError,
    );
  });

  it('fail-closes for staging/unknown NODE_ENV (production-like)', () => {
    setEnv({ NODE_ENV: 'staging' });
    expect(() => createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A)).toThrow(
      ReportDownloadSigningKeyMissingError,
    );
  });

  it('does not fall back to SIS_BOARD_EXPORT_SIGNING_SECRET in a deployed env', () => {
    setEnv({
      NODE_ENV: 'production',
      SIS_BOARD_EXPORT_SIGNING_SECRET: 'board-export-secret',
    });
    expect(() => createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A)).toThrow(
      ReportDownloadSigningKeyMissingError,
    );
  });

  it('signs and verifies with a dedicated secret in a deployed env', () => {
    setEnv({
      NODE_ENV: 'production',
      REPORT_DOWNLOAD_SIGNING_SECRET: 'dedicated-report-download-secret',
    });
    const signed = createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A);
    expect(verifyReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A, signed.token)).toEqual({
      ok: true,
    });
  });

  it('uses an ephemeral key in development without a committed literal', () => {
    setEnv({ NODE_ENV: 'development' });
    const signed = createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A);
    expect(verifyReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A, signed.token)).toEqual({
      ok: true,
    });
  });
});

describe('report download token owner binding (PRC-L337)', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'production',
      REPORT_DOWNLOAD_SIGNING_SECRET: 'dedicated-report-download-secret',
    });
  });

  // The token binds the artifact OWNER (requestedBy), resolved server-side.
  // Role authorisation (mayAccessArtifact) governs who may present it, so a
  // token minted for owner A still verifies against owner A no matter who
  // downloads (PRC-M631). A token must NOT verify against a different owner id
  // (forgery / cross-artifact reuse).
  it('rejects a token verified against a different owner id', () => {
    const signed = createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A);
    const result = verifyReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_B, signed.token);
    expect(result.ok).toBe(false);
  });

  it('verifies against the owner it was minted for, regardless of caller', () => {
    const signed = createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A);
    expect(verifyReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A, signed.token)).toEqual({
      ok: true,
    });
  });

  it('fail-closes verification when the deployed secret is unconfigured', () => {
    const signed = createReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A);
    // Drop the dedicated secret as if a redeploy lost it: verification must
    // reject, never accept.
    delete process.env.REPORT_DOWNLOAD_SIGNING_SECRET;
    const result = verifyReportDownloadToken(TENANT_A, ARTIFACT, ACTOR_A, signed.token);
    expect(result.ok).toBe(false);
  });
});
