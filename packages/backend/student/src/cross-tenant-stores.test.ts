/**
 * PRC-L366: store-level cross-tenant isolation for the newer student stores
 * (students-360, lifecycle certificates, import progress). Tenant B must not
 * read, list or delete tenant A rows, even with A's ids.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryLifecycleCertificateRepository } from './certificates/in-memory-repository.js';
import type { LifecycleCertificate } from './certificates/types.js';
import {
  CacheImportProgressStore,
  InMemoryImportProgressStore,
  type ImportProgressCache,
} from './import/progress-store.js';
import type { ImportProgress } from './import/types.js';
import { InMemoryStudents360Store } from './students-360/store.js';

const A = randomUUID();
const B = randomUUID();
const STUDENT = randomUUID();
const SIBLING = randomUUID();

async function seed360() {
  const store = new InMemoryStudents360Store();
  const now = new Date();
  await store.upsertPhoto({
    id: randomUUID(),
    tenantId: A,
    studentId: STUDENT,
    objectKey: 'photos/a.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    uploadedBy: 'u-a',
    createdAt: now,
  });
  await store.createSiblingPair(
    { id: randomUUID(), tenantId: A, studentId: STUDENT, siblingId: SIBLING, createdAt: now },
    { id: randomUUID(), tenantId: A, studentId: SIBLING, siblingId: STUDENT, createdAt: now },
  );
  await store.appendConsent({
    id: randomUUID(),
    tenantId: A,
    studentId: STUDENT,
    kind: 'photo',
    granted: true,
    actorId: 'u-a',
    recordedAt: now,
    version: 1,
    supersedesId: null,
    validFrom: now,
    validTo: null,
  });
  const incident = await store.createDiscipline({
    id: randomUUID(),
    tenantId: A,
    studentId: STUDENT,
    incidentType: 'late',
    severity: 'low',
    description: 'Late to class',
    actionTaken: null,
    reporterId: 'u-a',
    incidentDate: '2026-09-09',
    visibleToParent: false,
    createdAt: now,
  });
  const document = await store.createDocument({
    id: randomUUID(),
    tenantId: A,
    studentId: STUDENT,
    category: 'passport',
    fileName: 'passport.pdf',
    objectKey: 'docs/a.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    uploadedBy: 'u-a',
    createdAt: now,
  });
  return { store, incidentId: incident.id, documentId: document.id };
}

describe('students-360 store cross-tenant isolation (PRC-L366)', () => {
  it('tenant B reads nothing of tenant A', async () => {
    const { store, incidentId, documentId } = await seed360();
    expect(await store.getPhoto(B, STUDENT)).toBeNull();
    expect(await store.listSiblings(B, STUDENT)).toEqual([]);
    expect(await store.findSiblingLink(B, STUDENT, SIBLING)).toBeNull();
    expect(await store.listConsents(B, STUDENT)).toEqual([]);
    expect(await store.listConsentHistory(B, STUDENT)).toEqual([]);
    expect((await store.listDiscipline(B, STUDENT)).data).toEqual([]);
    expect(await store.findDiscipline(B, STUDENT, incidentId)).toBeNull();
    expect((await store.listDocuments(B, STUDENT)).data).toEqual([]);
    expect(await store.findDocument(B, STUDENT, documentId)).toBeNull();
  });

  it('tenant B deletes nothing of tenant A, and A rows survive', async () => {
    const { store, incidentId, documentId } = await seed360();
    expect(await store.deleteSiblingPair(B, STUDENT, SIBLING)).toBe(false);
    expect(await store.deleteDiscipline(B, STUDENT, incidentId)).toBe(false);
    expect(await store.deleteDocument(B, STUDENT, documentId)).toBe(false);
    expect(await store.getPhoto(A, STUDENT)).not.toBeNull();
    expect(await store.findSiblingLink(A, STUDENT, SIBLING)).not.toBeNull();
    expect(await store.listConsents(A, STUDENT)).toHaveLength(1);
    expect(await store.findDiscipline(A, STUDENT, incidentId)).not.toBeNull();
    expect(await store.findDocument(A, STUDENT, documentId)).not.toBeNull();
  });
});

describe('lifecycle certificate repository cross-tenant isolation (PRC-L366)', () => {
  it('tenant B cannot find, list or revoke tenant A certificates', async () => {
    const repo = new InMemoryLifecycleCertificateRepository();
    const cert: LifecycleCertificate = {
      id: randomUUID(),
      tenantId: A,
      studentId: STUDENT,
      type: 'bonafide',
      serialNumber: 'BON-2026-0001',
      status: 'issued',
      issuedBy: 'u-a',
      issuedAt: new Date(),
      revokedAt: null,
      revokeReason: null,
      academicYear: '2026-27',
      remarks: null,
      checksum: 'abc',
    };
    await repo.create(cert);
    expect(await repo.findById(B, cert.id)).toBeNull();
    expect(await repo.findBySerial(B, cert.serialNumber)).toBeNull();
    expect(await repo.listByStudent(B, STUDENT)).toEqual([]);
    expect(
      await repo.update(B, cert.id, {
        status: 'revoked',
        revokedAt: new Date(),
        revokeReason: 'x',
      }),
    ).toBeNull();
    expect(await repo.findById(A, cert.id)).toMatchObject({ status: 'issued', revokedAt: null });
  });
});

describe('import progress stores cross-tenant isolation (PRC-L366)', () => {
  const progress: ImportProgress = {
    jobId: 'job-a',
    status: 'completed',
    totalRows: 1,
    processedRows: 1,
    progressPercent: 100,
    startedAt: new Date().toISOString(),
  };

  it('InMemoryImportProgressStore: tenant B cannot read tenant A job', async () => {
    const store = new InMemoryImportProgressStore();
    await store.update(A, 'job-a', progress);
    expect(await store.get(B, 'job-a')).toBeNull();
    expect(await store.get(A, 'job-a')).toMatchObject({ jobId: 'job-a' });
  });

  it('CacheImportProgressStore: tenant B cannot read tenant A job', async () => {
    const map = new Map<string, unknown>();
    const cache: ImportProgressCache = {
      async get<T>(key: string) {
        return (map.get(key) as T | undefined) ?? null;
      },
      async set(key: string, value: unknown) {
        map.set(key, value);
      },
    };
    const store = new CacheImportProgressStore(cache);
    await store.update(A, 'job-a', progress);
    expect(await store.get(B, 'job-a')).toBeNull();
    expect(await store.get(A, 'job-a')).toMatchObject({ jobId: 'job-a' });
  });
});
