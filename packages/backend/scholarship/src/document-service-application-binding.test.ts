/**
 * PRC-M539: verify/reject are bound to the route's application. A reviewer who
 * names application A cannot decide a document of application B in the same
 * tenant by guessing its document id.
 */
import { Buffer } from 'node:buffer';

import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import type { ScholarshipActor } from './document-access.js';
import { PLACEHOLDER_PDF } from './document-bytes.js';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { ScholarshipDocumentService } from './document-service.js';
import { InMemoryScholarshipDocumentStore } from './document-store.js';
import type { ScholarshipApplicationEntity } from './scholarship-repository.js';
import type { ScholarshipService } from './scholarship-service.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const APP_A = '00000000-0000-4000-8000-00000000aa01';
const APP_B = '00000000-0000-4000-8000-00000000bb02';
const actor: ScholarshipActor = {
  userId: 'reviewer-1',
  userName: 'Reviewer',
  roles: ['scholarship_officer'],
  studentId: null,
  linkedStudentIds: [],
  ipAddress: '127.0.0.1',
};

async function setup() {
  const documents = new InMemoryScholarshipDocumentStore();
  const service = new ScholarshipDocumentService({
    documents,
    blobs: new InMemoryScholarshipDocumentBlobStore(),
    scholarshipService: {} as ScholarshipService,
  });
  const docOfB = await service.upload({
    tenantId: TENANT,
    application: { id: APP_B } as ScholarshipApplicationEntity,
    actor: actor,
    documentType: 'marksheet',
    filename: 'marks.pdf',
    declaredMime: 'application/pdf',
    bytes: Buffer.from(PLACEHOLDER_PDF),
  });
  return { documents, service, docOfB };
}

describe('scholarship document decisions are bound to the application (PRC-M539)', () => {
  it('verify through another application is not found and leaves the document pending', async () => {
    const { documents, service, docOfB } = await setup();
    await expect(service.verify(TENANT, docOfB.id, actor, { id: APP_A })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(documents.rows.get(docOfB.id)?.verificationStatus).toBe('PENDING');
    expect(documents.audits.some((entry) => entry.operation === 'UPDATE')).toBe(false);
  });

  it('reject through another application is not found and leaves the document pending', async () => {
    const { documents, service, docOfB } = await setup();
    await expect(
      service.reject(TENANT, docOfB.id, actor, { id: APP_A }, 'Unreadable'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(documents.rows.get(docOfB.id)?.verificationStatus).toBe('PENDING');
  });

  it('verify and reject through the owning application still work', async () => {
    const { service, docOfB } = await setup();
    const verified = await service.verify(TENANT, docOfB.id, actor, { id: APP_B });
    expect(verified.verificationStatus).toBe('VERIFIED');
    const again = await setup();
    const rejected = await again.service.reject(
      TENANT,
      again.docOfB.id,
      actor,
      { id: APP_B },
      'Unreadable',
    );
    expect(rejected.verificationStatus).toBe('REJECTED');
  });
});
