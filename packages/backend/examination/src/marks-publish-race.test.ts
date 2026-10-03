/**
 * PRC-M239 — concurrent marks entry keeps every subject, and marks entry racing a
 * publish is either rejected or fully included in the publication.
 */
import { describe, expect, it } from 'vitest';

import type { ExaminationEntity } from './examination-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { ResultPublicationService } from './result-publication-service.js';

const TENANT = 'tenant-m239';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const MATH = '44444444-4444-4444-8444-444444444444';
const SCI = '55555555-5555-4555-8555-555555555555';

async function setup() {
  const examRepo = new InMemoryExaminationRepository();
  const resultRepo = new InMemoryResultRepository();
  const subject = (id: string, code: string) => ({
    id,
    examinationId: 'exam-1',
    name: code,
    code,
    maxScore: 100,
    gradingSchemeId: null,
  });
  await examRepo.create({
    id: 'exam-1',
    tenantId: TENANT,
    name: 'E',
    code: 'E',
    description: null,
    academicPeriodId: 'p',
    startDate: '2025-06-01',
    endDate: '2025-06-15',
    status: 'IN_PROGRESS',
    subjects: [subject(MATH, 'M'), subject(SCI, 'S')],
    centers: [],
    sessions: [],
    gradingSchemes: [
      {
        id: 'gs',
        examinationId: 'exam-1',
        name: 'Std',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'P', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ExaminationEntity);
  await examRepo.createCandidateRegistration({
    id: 'reg-1',
    tenantId: TENANT,
    examinationId: 'exam-1',
    studentId: STUDENT,
    centerId: 'center-1',
    subjectIds: [MATH, SCI],
    status: 'REGISTERED',
    registeredAt: new Date(),
  });
  return { svc: new ResultPublicationService(examRepo, resultRepo), resultRepo };
}

describe('marks entry vs publish (PRC-M239)', () => {
  it('concurrent recordMarks for the same student keeps both subjects', async () => {
    const { svc, resultRepo } = await setup();
    await Promise.all([
      svc.recordMarks(TENANT, 'exam-1', {
        entries: [{ studentId: STUDENT, marks: [{ subjectId: MATH, score: 70 }] }],
      }),
      svc.recordMarks(TENANT, 'exam-1', {
        entries: [{ studentId: STUDENT, marks: [{ subjectId: SCI, score: 55 }] }],
      }),
    ]);
    const [candidate] = await resultRepo.getCandidates('exam-1', TENANT);
    expect(candidate!.subjectResults.map((r) => r.subjectId).sort()).toEqual([MATH, SCI].sort());
  });

  it('recordMarks racing publish is rejected or fully included', async () => {
    const { svc, resultRepo } = await setup();
    await svc.recordMarks(TENANT, 'exam-1', {
      entries: [{ studentId: STUDENT, marks: [{ subjectId: MATH, score: 70 }] }],
    });
    const [pub, marks] = await Promise.allSettled([
      svc.publishResults(TENANT, 'exam-1'),
      svc.recordMarks(TENANT, 'exam-1', {
        entries: [{ studentId: STUDENT, marks: [{ subjectId: SCI, score: 55 }] }],
      }),
    ]);
    if (pub.status === 'fulfilled' && marks.status === 'fulfilled') {
      throw new Error('both publish and late marks succeeded — marks would be excluded');
    }
    if (pub.status === 'fulfilled') {
      // Marks were rejected as locked; publication covers what was stored.
      expect(marks.status).toBe('rejected');
    } else {
      // Publish saw a changed snapshot → 409; marks were kept and a retry includes them.
      expect((pub.reason as { statusCode?: number }).statusCode).toBe(409);
      const retried = await svc.publishResults(TENANT, 'exam-1');
      expect(retried.gradeResults.map((g) => g.subjectId).sort()).toEqual([MATH, SCI].sort());
    }
    // Once published, marks are locked.
    await expect(
      svc.recordMarks(TENANT, 'exam-1', {
        entries: [{ studentId: STUDENT, marks: [{ subjectId: MATH, score: 99 }] }],
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(await resultRepo.getPublicationResult('exam-1', TENANT)).not.toBeNull();
  });
});
