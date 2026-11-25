/**
 * PRC-M215 (DR35): scholarship supporting documents are kept 8 years, then
 * erased. The retention sweep deletes the stored object first, then the row
 * with an audited DELETE; a failed object delete keeps the row for the next
 * run; documents inside their window are untouched.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { ScholarshipDocumentService } from './document-service.js';
import {
  InMemoryScholarshipDocumentStore,
  SCHOLARSHIP_DOCUMENT_RETENTION_YEARS,
  defaultDocumentRetentionUntil,
} from './document-store.js';
import { documentRetentionSweepSettings } from './scholarship-plugin.js';
import type { ScholarshipService } from './scholarship-service.js';

const NOW = new Date('2035-06-01T10:00:00.000Z');

async function setup() {
  const documents = new InMemoryScholarshipDocumentStore();
  const blobs = new InMemoryScholarshipDocumentBlobStore();
  const service = new ScholarshipDocumentService({
    documents,
    blobs,
    scholarshipService: {} as ScholarshipService,
  });
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  async function doc(tenantId: string, retentionUntil: Date | null) {
    const id = randomUUID();
    const objectKey = `scholarships/app/documents/${id}`;
    await blobs.put(objectKey, Buffer.from('%PDF-1.4 income certificate'));
    const row = await documents.insert(
      {
        id,
        tenantId,
        applicationId: randomUUID(),
        documentType: 'income_certificate',
        objectKey,
        originalFilename: 'income.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 27,
        sha256: 'a'.repeat(64),
        uploadedBy: 'staff-1',
      },
      {
        tenantId,
        entityId: id,
        operation: 'CREATE',
        userId: 'staff-1',
        userName: 'Staff',
        ipAddress: '127.0.0.1',
        metadata: {},
      },
    );
    row.retentionUntil = retentionUntil;
    return row;
  }
  return { documents, blobs, service, tenantA, tenantB, doc };
}

describe('PRC-M215 scholarship document retention (DR35)', () => {
  it('defaults retention to 8 years from the upload date', () => {
    expect(SCHOLARSHIP_DOCUMENT_RETENTION_YEARS).toBe(8);
    expect(defaultDocumentRetentionUntil(new Date('2026-03-15T18:30:00Z')).toISOString()).toBe(
      '2034-03-15T00:00:00.000Z',
    );
  });

  it('erases object then row for expired documents in every tenant, with a DELETE audit', async () => {
    const { documents, blobs, service, tenantA, tenantB, doc } = await setup();
    const expiredA = await doc(tenantA, new Date('2035-05-31T00:00:00Z'));
    const expiredB = await doc(tenantB, new Date('2034-01-01T00:00:00Z'));
    const keptToday = await doc(tenantA, new Date('2035-06-01T00:00:00Z'));
    const keptFuture = await doc(tenantA, new Date('2040-01-01T00:00:00Z'));
    const result = await service.runRetentionSweep(NOW);
    expect(result).toEqual({ tenants: 2, purged: 2, failures: [] });
    for (const gone of [expiredA, expiredB]) {
      expect(documents.rows.has(gone.id)).toBe(false);
      expect(await blobs.get(gone.objectKey)).toBeNull();
    }
    for (const kept of [keptToday, keptFuture]) {
      expect(documents.rows.has(kept.id)).toBe(true);
      expect(await blobs.get(kept.objectKey)).not.toBeNull();
    }
    const erasures = documents.audits.filter(
      (a) => a.operation === 'DELETE' && a.metadata['action'] === 'retention_erase',
    );
    expect(erasures.map((a) => a.entityId).sort()).toEqual([expiredA.id, expiredB.id].sort());
  });

  it('also erases a soft-deleted document once its retention has passed', async () => {
    const { documents, service, tenantA, doc } = await setup();
    const row = await doc(tenantA, new Date('2030-01-01T00:00:00Z'));
    row.deletedAt = new Date('2026-01-01T00:00:00Z');
    expect((await service.purgeExpiredDocuments(tenantA, NOW)).purged).toBe(1);
    expect(documents.rows.has(row.id)).toBe(false);
  });

  it('keeps the row (and its key) when the object delete fails', async () => {
    const { documents, blobs, service, tenantA, doc } = await setup();
    const row = await doc(tenantA, new Date('2030-01-01T00:00:00Z'));
    blobs.delete = async () => {
      throw new Error('storage unavailable');
    };
    const result = await service.purgeExpiredDocuments(tenantA, NOW);
    expect(result).toEqual({
      purged: 0,
      failures: [{ documentId: row.id, error: 'storage unavailable' }],
    });
    expect(documents.rows.get(row.id)?.objectKey).toBe(row.objectKey);
  });

  it('the sweep is on by default outside tests and can be turned off', () => {
    expect(documentRetentionSweepSettings({ NODE_ENV: 'production' })).toEqual({
      enabled: true,
      intervalMs: 6 * 60 * 60 * 1000,
    });
    expect(
      documentRetentionSweepSettings({
        NODE_ENV: 'production',
        SCHOLARSHIP_DOCUMENT_RETENTION_SWEEP: '0',
      }).enabled,
    ).toBe(false);
    expect(documentRetentionSweepSettings({ NODE_ENV: 'test' }).enabled).toBe(false);
  });
});
