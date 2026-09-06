import { describe, expect, it } from 'vitest';

import { InMemoryGradebookRepository } from './in-memory-repository.js';
import { GradebookService } from './gradebook-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const BOARD = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const SCALE = '55555555-5555-4555-8555-555555555555';

describe('GradebookService', () => {
  function setup() {
    const repo = new InMemoryGradebookRepository();
    repo.seedSection({
      id: SECTION,
      tenantId: TENANT,
      institutionId: '66666666-6666-4666-8666-666666666666',
      academicPeriodId: '77777777-7777-4777-8777-777777777777',
      code: '10-A',
      name: 'Class 10-A',
      status: 'PUBLISHED',
    });
    repo.seedScale({
      id: SCALE,
      tenantId: TENANT,
      boardId: BOARD,
      code: 'CBSE-9PT',
      name: 'CBSE 9-point',
      scaleType: 'PERCENT_BAND',
      isDefault: true,
      bands: [
        { label: 'A1', minPercent: 91, maxPercent: 100, gradePoints: 10 },
        { label: 'A2', minPercent: 81, maxPercent: 90.99, gradePoints: 9 },
        { label: 'E', minPercent: 0, maxPercent: 32.99, gradePoints: 0 },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return new GradebookService(repo);
  }

  it('upserts grades, computes GPA, issues versioned transcripts', async () => {
    const service = setup();
    await service.createCreditRule(TENANT, {
      code: 'CORE-1',
      name: 'Core subject',
      credits: 1,
      boardId: BOARD,
    });

    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 95,
      creditRuleCode: 'CORE-1',
    });
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'SCI',
      numericScore: 85,
      creditRuleCode: 'CORE-1',
    });

    const { snapshot } = await service.computeGpa(TENANT, {
      studentId: STUDENT,
      boardId: BOARD,
    });
    expect(snapshot.unweightedGpa).toBe(9.5);
    expect(snapshot.weightedGpa).toBe(9.5);
    expect(snapshot.creditsEarned).toBe(2);

    const t1 = await service.issueTranscript(TENANT, {
      studentId: STUDENT,
      gpaSnapshotId: snapshot.id,
    });
    expect(t1.version).toBe(1);
    expect(t1.status).toBe('ISSUED');
    expect(t1.checksumSha256).toHaveLength(64);

    const t2 = await service.issueTranscript(TENANT, { studentId: STUDENT });
    expect(t2.version).toBe(2);
    expect(t1.checksumSha256).not.toBe(t2.checksumSha256);

    const listed = await service.listTranscripts(TENANT, { studentId: STUDENT });
    expect(listed.map((t) => t.version)).toEqual([2, 1]);
  });

  it('creates report-card job with SUCCEEDED status metadata', async () => {
    const service = setup();
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'ENG',
      numericScore: 92,
    });
    await service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD });
    const job = await service.createReportCardJob(TENANT, {
      studentId: STUDENT,
      boardId: BOARD,
    });
    expect(job.jobType).toBe('REPORT_CARD');
    expect(job.status).toBe('SUCCEEDED');
    expect(job.artifactUri).toContain('report-cards');
    expect(job.metadata.checksumSha256).toBeTruthy();
  });
});
