import { describe, expect, it } from 'vitest';

import {
  createBoardExportDownloadToken,
  signTranscriptChecksum,
  verifyBoardExportDownloadToken,
  verifyTranscriptSignature,
} from './signed-download.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
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

describe('transcript signing stub', () => {
  it('signs and verifies checksum HMAC', () => {
    const checksum = 'a'.repeat(64);
    const sig = signTranscriptChecksum(checksum, TENANT);
    expect(sig).toHaveLength(64);
    expect(verifyTranscriptSignature(checksum, TENANT, sig)).toBe(true);
    expect(verifyTranscriptSignature(checksum, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sig)).toBe(
      false,
    );
  });
});
