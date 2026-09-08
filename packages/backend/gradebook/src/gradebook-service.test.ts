import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertGradebookAccess, hasGradebookAccess } from './gradebook-access.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';
import { GradebookService } from './gradebook-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TENANT_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOARD = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const SCALE = '55555555-5555-4555-8555-555555555555';

describe('GradebookService', () => {
  function setup() {
    process.env.SIS_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), 'sis-transcripts-'));
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
    expect(t1.artifactUri).toContain('transcript.pdf-lite.html');
    expect(t1.metadata.pdfLitePath).toBeTruthy();

    const t2 = await service.issueTranscript(TENANT, { studentId: STUDENT });
    expect(t2.version).toBe(2);
    expect(t1.checksumSha256).not.toBe(t2.checksumSha256);

    const listed = await service.listTranscripts(TENANT, { studentId: STUDENT });
    expect(listed.map((t) => t.version)).toEqual([2, 1]);

    const audits = service.listAudits(TENANT);
    expect(audits.some((a) => a.action === 'grade.upsert')).toBe(true);
    expect(audits.some((a) => a.action === 'transcript.issue')).toBe(true);
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

  it('isolates grade entries and transcripts across tenants', async () => {
    const service = setup();
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 90,
    });
    const entriesB = await service.listGradeEntries(TENANT_B, { studentId: STUDENT });
    expect(entriesB).toEqual([]);

    await service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD });
    const t = await service.issueTranscript(TENANT, { studentId: STUDENT });
    const listedB = await service.listTranscripts(TENANT_B, { studentId: STUDENT });
    expect(listedB).toEqual([]);
    expect(service.listAudits(TENANT_B)).toEqual([]);
    expect(t.tenantId).toBe(TENANT);
  });
});

describe('gradebook access', () => {
  it('allows teacher grade entry and denies transcript issue', () => {
    expect(hasGradebookAccess(['teacher'], 'grade.entry')).toBe(true);
    expect(hasGradebookAccess(['teacher'], 'transcript.issue')).toBe(false);
    expect(() => assertGradebookAccess(['teacher'], 'transcript.issue')).toThrow(/Forbidden/);
  });

  it('allows registrar transcript issue', () => {
    expect(hasGradebookAccess([{ roleId: 'registrar' }], 'transcript.issue')).toBe(true);
    expect(hasGradebookAccess(['super-admin'], 'transcript.issue')).toBe(true);
  });

  it('allows teacher submit but denies moderate/lock', () => {
    expect(hasGradebookAccess(['teacher'], 'grade.entry')).toBe(true);
    expect(hasGradebookAccess(['teacher'], 'grade.moderate')).toBe(false);
    expect(hasGradebookAccess(['registrar'], 'grade.moderate')).toBe(true);
  });
});

describe('GradebookService G-303 workflow + signing', () => {
  function setup() {
    process.env.SIS_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), 'sis-transcripts-'));
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
    return { service: new GradebookService(repo), repo };
  }

  it('runs draft → submit → approve → lock and blocks edits while locked', async () => {
    const { service } = setup();
    const entry = await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 95,
    });
    expect(entry.metadata.workflowStatus).toBe('DRAFT');

    const submitted = await service.transitionGradeEntry(TENANT, entry.id, 'submit');
    expect(submitted.metadata.workflowStatus).toBe('SUBMITTED');

    await expect(
      service.upsertGradeEntry(TENANT, {
        sectionId: SECTION,
        studentId: STUDENT,
        assessmentCode: 'MATH',
        numericScore: 90,
      }),
    ).rejects.toThrow(/SUBMITTED/);

    const approved = await service.transitionGradeEntry(TENANT, entry.id, 'approve');
    expect(approved.metadata.workflowStatus).toBe('APPROVED');

    const locked = await service.transitionGradeEntry(TENANT, entry.id, 'lock');
    expect(locked.metadata.workflowStatus).toBe('LOCKED');
    expect(locked.lockedAt).toBeTruthy();

    await expect(
      service.upsertGradeEntry(TENANT, {
        sectionId: SECTION,
        studentId: STUDENT,
        assessmentCode: 'MATH',
        numericScore: 88,
      }),
    ).rejects.toThrow(/locked/i);

    const audits = service.listAudits(TENANT);
    expect(audits.some((a) => a.action === 'grade.submit')).toBe(true);
    expect(audits.some((a) => a.action === 'grade.lock')).toBe(true);
  });

  it('embeds HMAC signature on issued transcripts', async () => {
    const { service } = setup();
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 95,
    });
    await service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD });
    const t = await service.issueTranscript(TENANT, { studentId: STUDENT });
    expect(t.metadata.signatureAlg).toBe('HMAC-SHA256');
    expect(typeof t.metadata.signature).toBe('string');
    expect(String(t.metadata.signature)).toHaveLength(64);
  });
});
