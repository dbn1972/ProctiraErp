import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isScholarshipDocSigningKeyMissingError,
  resetScholarshipDocSigningForTests,
  ScholarshipDocSigningKeyMissingError,
  signDocumentDownloadToken,
  verifyDocumentDownloadToken,
} from './document-bytes.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const DOCUMENT = '00000000-0000-4000-8000-0000000000d0';

/**
 * PRC-H082: the document download endpoint is JWT-exempt, so the signed token is the only
 * credential. A hard-coded default secret let anyone forge a token; issuance/verification must
 * fail closed in production when SCHOLARSHIP_DOC_URL_SECRET is unset.
 */
describe('scholarship document download token signing (PRC-H082)', () => {
  const savedSecret = process.env['SCHOLARSHIP_DOC_URL_SECRET'];
  const savedJwt = process.env['JWT_SECRET'];
  const savedNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    resetScholarshipDocSigningForTests();
    delete process.env['SCHOLARSHIP_DOC_URL_SECRET'];
    delete process.env['JWT_SECRET'];
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env['SCHOLARSHIP_DOC_URL_SECRET'];
    else process.env['SCHOLARSHIP_DOC_URL_SECRET'] = savedSecret;
    if (savedJwt === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = savedJwt;
    if (savedNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = savedNodeEnv;
    resetScholarshipDocSigningForTests();
  });

  it('fails closed when issuing in production without a configured secret', () => {
    process.env['NODE_ENV'] = 'production';
    try {
      signDocumentDownloadToken({ tenantId: TENANT, documentId: DOCUMENT });
      throw new Error('expected issuance to throw');
    } catch (error) {
      expect(isScholarshipDocSigningKeyMissingError(error)).toBe(true);
      expect((error as ScholarshipDocSigningKeyMissingError).statusCode).toBe(503);
    }
  });

  it('fails closed when verifying in production without a configured secret', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => verifyDocumentDownloadToken('abc.def')).toThrow(
      ScholarshipDocSigningKeyMissingError,
    );
  });

  it('rejects a token forged with the old hard-coded default secret', () => {
    // The previous implementation signed with this literal when the env var was unset.
    // A token minted with it must no longer verify (the default is gone).
    process.env['SCHOLARSHIP_DOC_URL_SECRET'] = 'a-real-configured-secret';
    const body = Buffer.from(
      JSON.stringify({
        tenantId: TENANT,
        documentId: DOCUMENT,
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
    ).toString('base64url');
    const forged = `${body}.${createHmac('sha256', 'dev-scholarship-doc-url-secret')
      .update(body)
      .digest('base64url')}`;
    expect(() => verifyDocumentDownloadToken(forged)).toThrow(/invalid/i);
  });

  it('rejects a secret aliased to JWT_SECRET', () => {
    process.env['JWT_SECRET'] = 'shared-jwt-secret';
    process.env['SCHOLARSHIP_DOC_URL_SECRET'] = 'shared-jwt-secret';
    expect(() => signDocumentDownloadToken({ tenantId: TENANT, documentId: DOCUMENT })).toThrow(
      ScholarshipDocSigningKeyMissingError,
    );
  });

  it('round-trips with a configured secret', () => {
    process.env['SCHOLARSHIP_DOC_URL_SECRET'] = 'a-real-configured-secret';
    const { token } = signDocumentDownloadToken({ tenantId: TENANT, documentId: DOCUMENT });
    const claims = verifyDocumentDownloadToken(token);
    expect(claims.tenantId).toBe(TENANT);
    expect(claims.documentId).toBe(DOCUMENT);
  });

  it('round-trips in non-production with an ephemeral per-process key', () => {
    // No configured secret, NODE_ENV=test → ephemeral key is generated and reused within process.
    const { token } = signDocumentDownloadToken({ tenantId: TENANT, documentId: DOCUMENT });
    const claims = verifyDocumentDownloadToken(token);
    expect(claims.documentId).toBe(DOCUMENT);
  });
});
