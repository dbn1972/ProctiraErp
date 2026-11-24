/**
 * PRC-M632: real-database tenancy and document binding for scholarships.
 *
 * Runs as the runtime role (`proctira_app`, FORCE RLS) against a database
 * migrated like CI. `PgScholarshipDocumentStore` filters on id only, so these
 * cases prove that row-level security, not the WHERE clause, hides tenant A's
 * applications and documents from tenant B. The document service binding
 * (PRC-M539) is checked on the same rows. Skips without DATABASE_URL; the CI
 * live gate (W3-TEST-03) fails on a skip.
 */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { NotFoundError } from '@proctira/common';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import { isPgScholarshipEnabled } from './create-scholarship-repository.js';
import type { ScholarshipActor } from './document-access.js';
import { PLACEHOLDER_PDF } from './document-bytes.js';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { ScholarshipDocumentService } from './document-service.js';
import { PgScholarshipDocumentStore } from './pg-document-store.js';
import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';
import type { ScholarshipApplicationEntity } from './scholarship-repository.js';
import type { ScholarshipService } from './scholarship-service.js';

const live = isPgScholarshipEnabled();

const reviewer: ScholarshipActor = {
  userId: 'reviewer-m632',
  userName: 'Reviewer',
  roles: ['scholarship_officer'],
  studentId: null,
  linkedStudentIds: [],
  ipAddress: '127.0.0.1',
};

async function seedTenant(repo: PgScholarshipRepository, applications: number) {
  const pool = getSharedScholarshipPool()!;
  const tenantId = randomUUID();
  const programId = randomUUID();
  await ensurePgTestTenant(pool, tenantId);
  await repo.createProgram({
    id: programId,
    tenantId,
    name: 'M632 Merit',
    description: null,
    applicationStartDate: '2026-01-01',
    applicationEndDate: '2026-12-31',
    totalSlots: 5,
    usedSlots: 0,
    amountPerRecipient: 1000,
    amountPerRecipientCents: 100_000,
    currency: 'INR',
    disbursementFrequency: 'one_time',
    eligibility: {},
    status: 'open',
    academicPeriodId: null,
    fundingSourceId: null,
  });
  const applicationIds: string[] = [];
  for (let i = 0; i < applications; i++) {
    const id = randomUUID();
    applicationIds.push(id);
    await repo.createApplication({
      id,
      tenantId,
      programId,
      applicantId: randomUUID(),
      institutionId: randomUUID(),
      status: 'submitted',
      academicRecords: [],
      financialInfo: {},
      documents: [],
      personalStatement: null,
      areaId: null,
      gender: null,
      workflowInstanceId: null,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewerId: null,
      reviewNotes: null,
    });
  }
  return { tenantId, applicationIds };
}

function services() {
  const pool = getSharedScholarshipPool()!;
  const repo = new PgScholarshipRepository(pool);
  const documents = new PgScholarshipDocumentStore(pool);
  const documentService = new ScholarshipDocumentService({
    documents,
    blobs: new InMemoryScholarshipDocumentBlobStore(),
    scholarshipService: {} as ScholarshipService,
  });
  return { repo, documents, documentService };
}

async function upload(
  documentService: ScholarshipDocumentService,
  tenantId: string,
  applicationId: string,
) {
  return documentService.upload({
    tenantId,
    application: { id: applicationId } as ScholarshipApplicationEntity,
    actor: reviewer,
    documentType: 'marksheet',
    filename: 'marks.pdf',
    declaredMime: 'application/pdf',
    bytes: Buffer.from(PLACEHOLDER_PDF),
  });
}

describe.skipIf(!live)('scholarship tenancy and document binding (live, PRC-M632)', () => {
  it('another tenant cannot read, list or decide tenant A rows (RLS, not the WHERE clause)', async () => {
    const { repo, documents, documentService } = services();
    const a = await seedTenant(repo, 1);
    const b = await seedTenant(repo, 1);
    const appA = a.applicationIds[0]!;
    const doc = await upload(documentService, a.tenantId, appA);

    expect(await repo.findApplicationById(appA, b.tenantId)).toBeNull();
    expect(await documents.findById(b.tenantId, doc.id)).toBeNull();
    expect(await documents.listActive(b.tenantId, appA)).toEqual([]);
    await expect(
      documentService.verify(b.tenantId, doc.id, reviewer, { id: appA }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const untouched = await documents.findById(a.tenantId, doc.id);
    expect(untouched?.verificationStatus).toBe('PENDING');
    expect(untouched?.tenantId).toBe(a.tenantId);
  });

  it('a pooled query without the tenant GUC sees no scholarship documents', async () => {
    const { repo, documentService } = services();
    const a = await seedTenant(repo, 1);
    const doc = await upload(documentService, a.tenantId, a.applicationIds[0]!);
    const pool = getSharedScholarshipPool()!;
    const { rows } = await pool.query(
      'SELECT id FROM scholarship_application_documents WHERE id = $1',
      [doc.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('verify/reject through a sibling application of the same tenant are not found', async () => {
    const { repo, documents, documentService } = services();
    const a = await seedTenant(repo, 2);
    const [appOne, appTwo] = a.applicationIds as [string, string];
    const doc = await upload(documentService, a.tenantId, appTwo);

    await expect(
      documentService.verify(a.tenantId, doc.id, reviewer, { id: appOne }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      documentService.reject(a.tenantId, doc.id, reviewer, { id: appOne }, 'Unreadable'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await documents.findById(a.tenantId, doc.id))?.verificationStatus).toBe('PENDING');

    const verified = await documentService.verify(a.tenantId, doc.id, reviewer, { id: appTwo });
    expect(verified.verificationStatus).toBe('VERIFIED');
  });
});
