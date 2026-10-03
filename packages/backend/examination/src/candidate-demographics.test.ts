/**
 * PRC-M240 — candidate gender/area come from the student record, never from the
 * client and never defaulted to 'other' / the exam centre.
 */
import { describe, expect, it } from 'vitest';

import type { ExaminationEntity } from './examination-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { ResultPublicationService } from './result-publication-service.js';
import { UNKNOWN_AREA_ID, normalizeCandidateGender } from './result-repository.js';

const TENANT = 'tenant-m240';
const SUBJECT = '44444444-4444-4444-8444-444444444444';
const KNOWN = '33333333-3333-4333-8333-333333333333';
const NO_RECORD = '33333333-3333-4333-8333-444444444444';
const AREA = '66666666-6666-4666-8666-666666666666';
const CLIENT_AREA = '77777777-7777-4777-8777-777777777777';

async function setup() {
  const examRepo = new InMemoryExaminationRepository();
  const resultRepo = new InMemoryResultRepository();
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
    subjects: [
      { id: SUBJECT, examinationId: 'exam-1', name: 'M', code: 'M', maxScore: 100, gradingSchemeId: null },
    ],
    centers: [{ id: 'center-1', examinationId: 'exam-1', name: 'C', code: 'C', institutionId: 'i', capacity: 10 }],
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
  for (const [id, studentId] of [
    ['reg-1', KNOWN],
    ['reg-2', NO_RECORD],
  ] as const) {
    await examRepo.createCandidateRegistration({
      id,
      tenantId: TENANT,
      examinationId: 'exam-1',
      studentId,
      centerId: 'center-1',
      subjectIds: [SUBJECT],
      status: 'REGISTERED',
      registeredAt: new Date(),
    });
  }
  examRepo.setStudentEnrollment({
    studentId: KNOWN,
    status: 'enrolled',
    institutionId: 'inst-1',
    completedSubjectCodes: null,
    gender: 'F',
    areaId: AREA,
  });
  return { svc: new ResultPublicationService(examRepo, resultRepo), resultRepo };
}

describe('candidate demographics (PRC-M240)', () => {
  it('ignores client gender/area and uses the student record', async () => {
    const { svc, resultRepo } = await setup();
    await svc.recordMarks(TENANT, 'exam-1', {
      entries: [
        {
          studentId: KNOWN,
          gender: 'male',
          areaId: CLIENT_AREA,
          marks: [{ subjectId: SUBJECT, score: 70 }],
        },
      ],
    });
    const [c] = await resultRepo.getCandidates('exam-1', TENANT);
    expect(c!.gender).toBe('female');
    expect(c!.areaId).toBe(AREA);
  });

  it("marks without a student record land in 'unknown' buckets, never 'other' or the centre", async () => {
    const { svc, resultRepo } = await setup();
    await svc.recordMarks(TENANT, 'exam-1', {
      entries: [
        { studentId: KNOWN, marks: [{ subjectId: SUBJECT, score: 70 }] },
        { studentId: NO_RECORD, marks: [{ subjectId: SUBJECT, score: 50 }] },
      ],
    });
    const stored = await resultRepo.getCandidates('exam-1', TENANT);
    const unknown = stored.find((c) => c.studentId === NO_RECORD)!;
    expect(unknown.gender).toBe('unknown');
    expect(unknown.areaId).toBe(UNKNOWN_AREA_ID);
    expect(unknown.areaId).not.toBe('center-1');

    await svc.publishResults(TENANT, 'exam-1');
    const analysis = await svc.generateAnalysis(TENANT, 'exam-1');
    const genders = analysis.byGender.map((b) => b.dimensionId);
    expect(genders).toContain('unknown');
    expect(genders).not.toContain('other');
    const areas = analysis.byArea.map((b) => b.dimensionId);
    expect(areas).toContain('unknown');
    expect(areas).not.toContain('center-1');
  });

  it('normalises raw student-record gender values', () => {
    expect(normalizeCandidateGender('M')).toBe('male');
    expect(normalizeCandidateGender('Female')).toBe('female');
    expect(normalizeCandidateGender('non-binary')).toBe('other');
    expect(normalizeCandidateGender('')).toBe('unknown');
    expect(normalizeCandidateGender(null)).toBe('unknown');
  });
});
