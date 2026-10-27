/**
 * PRC-L366 — PgStudents360Store cross-tenant isolation on a real, migrated Postgres (runtime
 * app role, RLS enforced). Every tenant-B read of tenant-A photo / sibling / consent /
 * discipline / document rows is empty, and tenant-B deletes leave A's rows intact.
 */
import { randomUUID } from 'node:crypto';
import { closeSharedPgPools, getSharedPgPool } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStudents360Store } from './store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-store-tenant-isolation.live.test' });
const pool = DATABASE_URL ? getSharedPgPool() : null;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const STUDENT_A = randomUUID();
const SIBLING_A = randomUUID();
const INCIDENT_A = randomUUID();
const DOCUMENT_A = randomUUID();

afterAll(async () => {
  await closeSharedPgPools();
});

describe.skipIf(!pool)('PgStudents360Store live cross-tenant isolation (PRC-L366)', () => {
  const store = new PgStudents360Store(pool! as never);

  beforeAll(async () => {
    await ensurePgTestTenant(pool!, TENANT_B);
    await ensurePgTestStudent(pool!, TENANT_A, STUDENT_A);
    await ensurePgTestStudent(pool!, TENANT_A, SIBLING_A);
    const now = new Date();
    await store.upsertPhoto({
      id: randomUUID(),
      tenantId: TENANT_A,
      studentId: STUDENT_A,
      objectKey: `photos/${STUDENT_A}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      uploadedBy: 'staff-a',
      createdAt: now,
    });
    await store.createSiblingPair(
      {
        id: randomUUID(),
        tenantId: TENANT_A,
        studentId: STUDENT_A,
        siblingId: SIBLING_A,
        createdAt: now,
      },
      {
        id: randomUUID(),
        tenantId: TENANT_A,
        studentId: SIBLING_A,
        siblingId: STUDENT_A,
        createdAt: now,
      },
    );
    await store.appendConsent({
      id: randomUUID(),
      tenantId: TENANT_A,
      studentId: STUDENT_A,
      kind: 'photo',
      granted: true,
      actorId: 'guardian-a',
      recordedAt: now,
      version: 1,
      supersedesId: null,
      validFrom: now,
      validTo: null,
    });
    await store.createDiscipline({
      id: INCIDENT_A,
      tenantId: TENANT_A,
      studentId: STUDENT_A,
      incidentType: 'late',
      severity: 'low',
      description: 'Late to class',
      actionTaken: null,
      reporterId: 'staff-a',
      incidentDate: '2026-01-15',
      visibleToParent: true,
      createdAt: now,
    });
    await store.createDocument({
      id: DOCUMENT_A,
      tenantId: TENANT_A,
      studentId: STUDENT_A,
      category: 'birth_certificate',
      fileName: 'birth.pdf',
      objectKey: `docs/${DOCUMENT_A}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      uploadedBy: 'staff-a',
      createdAt: now,
    });
  });

  it("tenant B reads none of tenant A's student 360 rows", async () => {
    expect(await store.getPhoto(TENANT_B, STUDENT_A)).toBeNull();
    expect(await store.listSiblings(TENANT_B, STUDENT_A)).toEqual([]);
    expect(await store.findSiblingLink(TENANT_B, STUDENT_A, SIBLING_A)).toBeNull();
    expect(await store.listConsents(TENANT_B, STUDENT_A)).toEqual([]);
    expect(await store.listConsentHistory(TENANT_B, STUDENT_A)).toEqual([]);
    expect(await store.listConsentHistory(TENANT_B, STUDENT_A, 'photo')).toEqual([]);
    expect(await store.listDiscipline(TENANT_B, STUDENT_A)).toEqual({ data: [], total: 0 });
    expect(await store.findDiscipline(TENANT_B, STUDENT_A, INCIDENT_A)).toBeNull();
    expect(await store.listDocuments(TENANT_B, STUDENT_A)).toEqual({ data: [], total: 0 });
    expect(await store.findDocument(TENANT_B, STUDENT_A, DOCUMENT_A)).toBeNull();
  });

  it("tenant B deletes do nothing and tenant A's rows stay intact", async () => {
    expect(await store.deleteDiscipline(TENANT_B, STUDENT_A, INCIDENT_A)).toBe(false);
    expect(await store.deleteDocument(TENANT_B, STUDENT_A, DOCUMENT_A)).toBe(false);
    expect(await store.deleteSiblingPair(TENANT_B, STUDENT_A, SIBLING_A)).toBe(false);

    expect((await store.getPhoto(TENANT_A, STUDENT_A))?.studentId).toBe(STUDENT_A);
    expect((await store.listSiblings(TENANT_A, STUDENT_A)).map((s) => s.siblingId)).toEqual([
      SIBLING_A,
    ]);
    expect((await store.listConsents(TENANT_A, STUDENT_A)).map((c) => c.kind)).toEqual(['photo']);
    expect((await store.findDiscipline(TENANT_A, STUDENT_A, INCIDENT_A))?.id).toBe(INCIDENT_A);
    expect((await store.listDocuments(TENANT_A, STUDENT_A)).total).toBe(1);
    expect((await store.findDocument(TENANT_A, STUDENT_A, DOCUMENT_A))?.id).toBe(DOCUMENT_A);
  });
});
