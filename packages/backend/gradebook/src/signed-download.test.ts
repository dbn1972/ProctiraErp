import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBoardExportDownloadToken,
  DEV_EPHEMERAL_TRANSCRIPT_KEY_ID,
  DEV_EPHEMERAL_TRANSCRIPT_KMS_REF,
  prepareTranscriptSigningAtStartup,
  resetDevTranscriptSigningForTests,
  resolveTranscriptSigningMaterial,
  signTranscriptChecksum,
  TranscriptSigningKeyMissingError,
  verifyBoardExportDownloadToken,
  verifyTranscriptSignature,
} from './signed-download.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INST = '66666666-6666-4666-8666-666666666666';
const JOB = '99999999-9999-4999-8999-999999999999';

describe('board export signed download', () => {
  it('issues and verifies a token for the same tenant+job', () => {
    const { token, expiresInSeconds } = createBoardExportDownloadToken(TENANT, JOB, 120);
    expect(expiresInSeconds).toBe(120);
    expect(verifyBoardExportDownloadToken(TENANT, JOB, token)).toEqual({ ok: true });
  });

  it('rejects wrong tenant or job', () => {
    const { token } = createBoardExportDownloadToken(TENANT, JOB, 120);
    expect(
      verifyBoardExportDownloadToken('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', JOB, token).ok,
    ).toBe(false);
    expect(
      verifyBoardExportDownloadToken(TENANT, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', token).ok,
    ).toBe(false);
  });

  it('rejects malformed and expired tokens', () => {
    expect(verifyBoardExportDownloadToken(TENANT, JOB, 'nope').ok).toBe(false);
    const past = `${Math.floor(Date.now() / 1000) - 10}.deadbeef`;
    expect(verifyBoardExportDownloadToken(TENANT, JOB, past).ok).toBe(false);
  });
});

describe('W1-DATA-08 transcript dedicated signing', () => {
  const prevSecret = process.env.TRANSCRIPT_SIGNING_SECRET;
  const prevKms = process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
  const prevKeyId = process.env.TRANSCRIPT_SIGNING_KEY_ID;
  const prevJwt = process.env.JWT_SECRET;
  const prevBoard = process.env.SIS_BOARD_EXPORT_SIGNING_SECRET;
  const prevNode = process.env.NODE_ENV;

  beforeEach(() => {
    resetDevTranscriptSigningForTests();
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.TRANSCRIPT_SIGNING_SECRET;
    else process.env.TRANSCRIPT_SIGNING_SECRET = prevSecret;
    if (prevKms === undefined) delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    else process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = prevKms;
    if (prevKeyId === undefined) delete process.env.TRANSCRIPT_SIGNING_KEY_ID;
    else process.env.TRANSCRIPT_SIGNING_KEY_ID = prevKeyId;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevBoard === undefined) delete process.env.SIS_BOARD_EXPORT_SIGNING_SECRET;
    else process.env.SIS_BOARD_EXPORT_SIGNING_SECRET = prevBoard;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  });

  it('signs and verifies with dedicated secret (no JWT fallback)', () => {
    process.env.TRANSCRIPT_SIGNING_SECRET = 'dedicated-transcript-hmac-material-v1';
    process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'arn:aws:kms:us-east-1:123:key/transcript-1';
    delete process.env.JWT_SECRET;
    delete process.env.SIS_BOARD_EXPORT_SIGNING_SECRET;

    const checksum = 'a'.repeat(64);
    const sig = signTranscriptChecksum(checksum, TENANT, INST);
    expect(sig).toHaveLength(64);
    expect(verifyTranscriptSignature(checksum, TENANT, sig, INST)).toBe(true);
    expect(verifyTranscriptSignature(checksum, TENANT, sig, null)).toBe(false);
    expect(
      verifyTranscriptSignature(checksum, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sig, INST),
    ).toBe(false);
  });

  it('fail-closes in production when the dedicated secret is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TRANSCRIPT_SIGNING_SECRET;
    delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    process.env.JWT_SECRET = 'should-not-be-used-for-transcripts';
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET = 'also-not-for-transcripts';
    expect(() => signTranscriptChecksum('a'.repeat(64), TENANT)).toThrow(
      TranscriptSigningKeyMissingError,
    );
    try {
      signTranscriptChecksum('a'.repeat(64), TENANT);
    } catch (error) {
      expect(error).toBeInstanceOf(TranscriptSigningKeyMissingError);
      const body = (error as TranscriptSigningKeyMissingError).toJSON();
      expect(body.statusCode).toBe(503);
      expect(body.code).toBe('TRANSCRIPT_SIGNING_KEY_MISSING');
      expect(body.message).toMatch(/TRANSCRIPT_SIGNING_SECRET/);
      expect(body.message).toMatch(/TRANSCRIPT_SIGNING_KMS_KEY_REF/);
      expect(body.message).not.toMatch(/should-not-be-used-for-transcripts/);
    }
  });

  it('uses one logged ephemeral key outside production when the secret is unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.TRANSCRIPT_SIGNING_SECRET;
    delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    delete process.env.TRANSCRIPT_SIGNING_KEY_ID;
    process.env.JWT_SECRET = 'jwt-must-not-become-the-transcript-key';
    const warnings: unknown[][] = [];
    const log = {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
      error: () => {
        throw new Error('production error log must not run outside production');
      },
    };

    prepareTranscriptSigningAtStartup(process.env, log);
    const checksum = 'b'.repeat(64);
    const first = resolveTranscriptSigningMaterial(
      { tenantId: TENANT, institutionId: INST },
      process.env,
      log,
    );
    const second = resolveTranscriptSigningMaterial(
      { tenantId: TENANT, institutionId: INST },
      process.env,
      log,
    );
    const signature = signTranscriptChecksum(checksum, TENANT, INST);

    expect(first.keyId).toBe(DEV_EPHEMERAL_TRANSCRIPT_KEY_ID);
    expect(first.kmsKeyRef).toBe(DEV_EPHEMERAL_TRANSCRIPT_KMS_REF);
    expect(first.hmacKey.equals(second.hmacKey)).toBe(true);
    expect(verifyTranscriptSignature(checksum, TENANT, signature, INST)).toBe(true);
    expect(warnings).toHaveLength(1);
    const serialized = JSON.stringify(warnings);
    expect(serialized).toMatch(/TRANSCRIPT_SIGNING_SECRET/);
    expect(serialized).toMatch(/ephemeral/);
    expect(serialized).not.toContain(first.hmacKey.toString('base64'));
    expect(serialized).not.toContain('jwt-must-not-become-the-transcript-key');
  });

  it('fail-closes in production without KMS/PKI ref', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRANSCRIPT_SIGNING_SECRET = 'dedicated-transcript-hmac-material-v1';
    delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    expect(() => resolveTranscriptSigningMaterial({ tenantId: TENANT }, process.env)).toThrow(
      /TRANSCRIPT_SIGNING_KMS_KEY_REF/i,
    );
  });

  it('rejects JWT / board-export secret reuse and kms ref aliases', () => {
    process.env.JWT_SECRET = 'shared-bad-secret';
    process.env.TRANSCRIPT_SIGNING_SECRET = 'shared-bad-secret';
    process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'env:TRANSCRIPT_SIGNING_SECRET';
    expect(() => resolveTranscriptSigningMaterial({ tenantId: TENANT })).toThrow(
      /must not equal JWT_SECRET/i,
    );

    process.env.TRANSCRIPT_SIGNING_SECRET = 'dedicated-ok';
    process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'env:JWT_SECRET';
    expect(() => resolveTranscriptSigningMaterial({ tenantId: TENANT })).toThrow(
      /must not reference JWT_SECRET/i,
    );
  });

  it('derives different HMAC keys per institution under the same tenant', () => {
    process.env.TRANSCRIPT_SIGNING_SECRET = 'dedicated-transcript-hmac-material-v1';
    process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'vault:transit/transcript';
    const a = resolveTranscriptSigningMaterial({ tenantId: TENANT, institutionId: INST });
    const b = resolveTranscriptSigningMaterial({
      tenantId: TENANT,
      institutionId: '77777777-7777-4777-8777-777777777777',
    });
    expect(a.hmacKey.equals(b.hmacKey)).toBe(false);
    expect(a.kmsKeyRef).toBe('vault:transit/transcript');
  });
});
