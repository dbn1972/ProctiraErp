/**
 * PRC-L304 — marks entry rejects negative/huge scores and oversized mark
 * arrays at the schema boundary, and duplicate student/subject entries in
 * the service (instead of silently last-write-wins).
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { ExaminationEntity } from './examination-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { ResultPublicationService } from './result-publication-service.js';
import { RecordMarksSchema } from './result-schemas.js';

const TENANT = 'tenant-l304';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const SUBJECT = '44444444-4444-4444-8444-444444444444';

function body(score: number, marksCount = 1): unknown {
  return {
    entries: [
      {
        studentId: STUDENT,
        marks: Array.from({ length: marksCount }, () => ({ subjectId: SUBJECT, score })),
      },
    ],
  };
}

describe('RecordMarksSchema bounds (PRC-L304)', () => {
  it('rejects score -1 at the schema', () => {
    expect(validate(RecordMarksSchema, body(-1)).success).toBe(false);
  });
  it('rejects absurdly large scores at the schema', () => {
    expect(validate(RecordMarksSchema, body(1e308)).success).toBe(false);
  });
  it('rejects more than 50 marks per entry', () => {
    expect(validate(RecordMarksSchema, body(10, 51)).success).toBe(false);
    expect(validate(RecordMarksSchema, body(10, 50)).success).toBe(true);
  });
});

describe('recordMarks duplicate entries (PRC-L304)', () => {
  async function setup() {
    const examRepo = new InMemoryExaminationRepository();
    const resultRepo = new InMemoryResultRepository();
    const exam: ExaminationEntity = {
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
        {
          id: SUBJECT,
          examinationId: 'exam-1',
          name: 'M',
          code: 'M',
          maxScore: 100,
          gradingSchemeId: null,
        },
      ],
      centers: [],
      sessions: [],
      gradingSchemes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ExaminationEntity;
    await examRepo.create(exam);
    await examRepo.createCandidateRegistration({
      id: 'reg-1',
      examinationId: 'exam-1',
      studentId: STUDENT,
      tenantId: TENANT,
      centerId: 'ctr',
      subjectIds: [SUBJECT],
      status: 'REGISTERED',
      registeredAt: new Date(),
    });
    return { svc: new ResultPublicationService(examRepo, resultRepo), resultRepo };
  }

  it('rejects the same student twice in one request', async () => {
    const { svc, resultRepo } = await setup();
    await expect(
      svc.recordMarks(TENANT, 'exam-1', {
        entries: [
          { studentId: STUDENT, marks: [{ subjectId: SUBJECT, score: 40 }] },
          { studentId: STUDENT, marks: [{ subjectId: SUBJECT, score: 90 }] },
        ],
      }),
    ).rejects.toThrow(ValidationError);
    expect(await resultRepo.getCandidates('exam-1', TENANT)).toEqual([]);
  });

  it('rejects the same subject twice for one student', async () => {
    const { svc } = await setup();
    await expect(
      svc.recordMarks(TENANT, 'exam-1', {
        entries: [
          {
            studentId: STUDENT,
            marks: [
              { subjectId: SUBJECT, score: 40 },
              { subjectId: SUBJECT, score: 90 },
            ],
          },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });
});
