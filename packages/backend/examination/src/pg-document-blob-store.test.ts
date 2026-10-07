/**
 * PRC-H052: the durable document blob store derives the tenant id from the
 * storage key (documents/<tenantId>/<examinationId>/<file>) to bind RLS. The
 * round-trip against Postgres is covered by the live suite; this unit test
 * pins the key parsing that drives tenant isolation.
 */
import { describe, expect, it } from 'vitest';

import { tenantIdFromDocumentKey } from './pg-document-blob-store.js';

describe('tenantIdFromDocumentKey (PRC-H052)', () => {
  it('extracts the tenant id from a well-formed document key', () => {
    const key = 'documents/11111111-1111-4111-8111-111111111111/exam-9/admit_card_abc.pdf';
    expect(tenantIdFromDocumentKey(key)).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('returns null when the key has no tenant segment', () => {
    expect(tenantIdFromDocumentKey('documents')).toBeNull();
    expect(tenantIdFromDocumentKey('documents/')).toBeNull();
  });
});
