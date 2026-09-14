import { afterEach, describe, expect, it } from 'vitest';

import {
  createBoardExportDownloadToken,
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

  it('fail-closes when dedicated secret is missing', () => {
    delete process.env.TRANSCRIPT_SIGNING_SECRET;
    process.env.JWT_SECRET = 'should-not-be-used-for-transcripts';
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET = 'also-not-for-transcripts';
    expect(() => signTranscriptChecksum('a'.repeat(64), TENANT)).toThrow(
      TranscriptSigningKeyMissingError,
    );
  });

  it('fail-closes in production without KMS/PKI ref', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRANSCRIPT_SIGNING_SECRET = 'dedicated-transcript-hmac-material-v1';
    delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    expect(() =>
      resolveTranscriptSigningMaterial({ tenantId: TENANT }, process.env),
    ).toThrow(/TRANSCRIPT_SIGNING_KMS_KEY_REF/i);
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
