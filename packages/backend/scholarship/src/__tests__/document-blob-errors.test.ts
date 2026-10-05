/**
 * PRC-M356: storage errors are 503 (not "no longer available" 404), blobs are
 * retained on soft delete, and documents on submitted/approved applications
 * cannot be removed (409).
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { StorageAdapter } from '@proctira/storage';
import {
  InMemoryScholarshipDocumentBlobStore,
  StorageAdapterScholarshipDocumentBlobStore,
} from '../document-blob-store.js';
import { InMemoryScholarshipDocumentStore } from '../document-store.js';
import { ScholarshipDocumentService } from '../document-service.js';
import type { ScholarshipActor } from '../document-access.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const APP_ID = '00000000-0000-4000-8000-0000000000a2';
const actor: ScholarshipActor = {
  userId: 'staff-1',
  userName: 'Staff',
  roles: ['bursar'],
  studentId: null,
  linkedStudentIds: [],
  ipAddress: '127.0.0.1',
};

function adapter(download: () => Promise<Readable>): StorageAdapter {
  return { download } as unknown as StorageAdapter;
}

async function seed(blobs = new InMemoryScholarshipDocumentBlobStore()) {
  const documents = new InMemoryScholarshipDocumentStore();
  const key = await blobs.put(
    'scholarships/x/documents/d1',
    Buffer.from('%PDF-1.4'),
    'application/pdf',
    TENANT,
  );
  documents.rows.set('d1', {
    id: 'd1',
    tenantId: TENANT,
    applicationId: APP_ID,
    documentType: 'income_certificate',
    objectKey: key,
    originalFilename: 'a.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 8,
    sha256: 'x',
    uploadedBy: 'staff-1',
    uploadedAt: new Date(),
    verificationStatus: 'PENDING',
    reviewerId: null,
    rejectionReason: null,
    reviewedAt: null,
    deletedAt: null,
  });
  const service = new ScholarshipDocumentService({
    documents,
    blobs,
    scholarshipService: {} as never,
  });
  return { service, documents, blobs, key };
}

describe('scholarship document blob errors (PRC-M356)', () => {
  it('returns null only for a missing object and rethrows provider errors', async () => {
    const missing = new StorageAdapterScholarshipDocumentBlobStore(
      adapter(async () => {
        throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
      }),
    );
    await expect(missing.get('k')).resolves.toBeNull();
    const broken = new StorageAdapterScholarshipDocumentBlobStore(
      adapter(async () => {
        throw Object.assign(new Error('InternalError'), { $metadata: { httpStatusCode: 500 } });
      }),
    );
    await expect(broken.get('k')).rejects.toThrow('InternalError');
  });

  it('maps a storage outage to 503, not 404', async () => {
    const blobs = new InMemoryScholarshipDocumentBlobStore();
    const { service } = await seed(blobs);
    blobs.get = async () => {
      throw new Error('S3 500');
    };
    await expect(service.readBytes(TENANT, 'd1')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('refuses deletion on an approved application with 409', async () => {
    const { service, documents } = await seed();
    for (const status of ['submitted', 'under_review', 'approved'] as const) {
      await expect(
        service.remove(TENANT, 'd1', actor, { id: APP_ID, status }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(documents.rows.get('d1')!.deletedAt).toBeNull();
  });

  it('soft-deletes a draft document and retains the blob for the retention job', async () => {
    const { service, blobs, key } = await seed();
    await service.remove(TENANT, 'd1', actor, { id: APP_ID, status: 'draft' });
    await expect(blobs.get(key)).resolves.not.toBeNull();
  });

  it('404s when the document belongs to another application', async () => {
    const { service } = await seed();
    await expect(
      service.remove(TENANT, 'd1', actor, {
        id: '00000000-0000-4000-8000-0000000000ff',
        status: 'draft',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
