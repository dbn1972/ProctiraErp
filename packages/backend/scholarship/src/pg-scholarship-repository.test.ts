/**
 * Unit tests for scholarship repository factory + Pg smoke (G-204).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createScholarshipRepository,
  isPgScholarshipEnabled,
} from './create-scholarship-repository.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';

describe('createScholarshipRepository', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isPgScholarshipEnabled()).toBe(false);
      expect(createScholarshipRepository()).toBeInstanceOf(InMemoryScholarshipRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });
});

describe('PgScholarshipRepository', () => {
  it.skipIf(!isPgScholarshipEnabled())(
    'persists program, application, and disbursement',
    async () => {
      const pool = getSharedScholarshipPool();
      expect(pool).not.toBeNull();
      const repo = new PgScholarshipRepository(pool!);
      const tenantId = randomUUID();
      const programId = randomUUID();
      const applicationId = randomUUID();
      const disbursementId = randomUUID();
      const applicantId = randomUUID();
      const institutionId = randomUUID();

      await repo.createProgram({
        id: programId,
        tenantId,
        name: 'Merit Award',
        description: null,
        applicationStartDate: '2026-01-01',
        applicationEndDate: '2026-12-31',
        totalSlots: 10,
        usedSlots: 0,
        amountPerRecipient: 1000,
        currency: 'USD',
        disbursementFrequency: 'one_time',
        eligibility: { minGPA: 3.0 },
        status: 'open',
        academicPeriodId: null,
        fundingSourceId: null,
      });

      const foundProgram = await repo.findProgramById(programId, tenantId);
      expect(foundProgram?.name).toBe('Merit Award');

      await repo.createApplication({
        id: applicationId,
        tenantId,
        programId,
        applicantId,
        institutionId,
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

      await repo.createDisbursement({
        id: disbursementId,
        tenantId,
        applicationId,
        amount: 1000,
        scheduledDate: '2026-06-01',
        paidDate: null,
        paymentStatus: 'scheduled',
        paymentMethod: null,
        transactionReference: null,
        notes: null,
      });

      const apps = await repo.listApplications(tenantId, { programId }, { page: 1, pageSize: 10 });
      expect(apps.data.some((a) => a.id === applicationId)).toBe(true);

      const disbursements = await repo.listDisbursementsByApplication(applicationId, tenantId);
      expect(disbursements.some((d) => d.id === disbursementId)).toBe(true);
    },
  );
});
