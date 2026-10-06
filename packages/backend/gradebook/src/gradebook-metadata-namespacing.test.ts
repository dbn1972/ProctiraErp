/**
 * PRC-M263: client metadata can never overwrite server-computed/signed fields.
 */
import { describe, expect, it } from 'vitest';

import { BOARD, SECTION, STUDENT, TENANT, setupGradebook } from './gradebook-test-setup.js';

describe('PRC-M263 metadata namespacing', () => {
  it('issue with metadata.weightedGpa=99 -> stored/signed weightedGpa equals snapshot', async () => {
    const { service } = setupGradebook();
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 95,
    });
    const { snapshot } = await service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD });
    const t = await service.issueTranscript(TENANT, {
      studentId: STUDENT,
      gpaSnapshotId: snapshot.id,
      metadata: { weightedGpa: 99, version: 42, studentId: 'x', note: 'ok' },
    } as never);
    expect(t.metadata.weightedGpa).toBe(snapshot.weightedGpa);
    expect(t.metadata.version).toBe(1);
    expect(t.metadata.studentId).toBe(STUDENT);
    expect((t.metadata.clientMetadata as Record<string, unknown>).note).toBe('ok');
  });

  it('report-card metadata cannot override studentId/academicPeriodId', async () => {
    const { service } = setupGradebook();
    const job = await service.createReportCardJob(TENANT, {
      studentId: STUDENT,
      boardId: BOARD,
      metadata: { studentId: 'forged', academicPeriodId: 'forged' },
    } as never);
    expect(job.metadata.studentId).toBe(STUDENT);
    expect(job.metadata.academicPeriodId).toBeNull();
  });
});
