/**
 * PRC-M161 (defaulted decision): results only for students ENROLLED in the item's academic
 * period; ASSESSMENT_RESULT_ENROLMENT_CHECK=off disables the check.
 */
import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AssessmentItemEntity } from './assessment-repository.js';
import { AssessmentService } from './assessment-service.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import {
  readEnrolmentCheckMode,
  ResultService,
  type ResultStudentDirectory,
} from './result-service.js';

const tenantId = 'tenant-m161-enrol';
const subject = '11111111-1111-4111-8111-111111111111';
const period = '22222222-2222-4222-8222-222222222222';
const enrolled = '33333333-3333-4333-8333-333333333333';
const notEnrolled = '33333333-3333-4333-8333-444444444444';

const directory: ResultStudentDirectory = {
  async findExistingStudentIds(_t, ids) {
    return new Set(ids);
  },
  async findEnrolledStudentIds(_t, academicPeriodId, ids) {
    return new Set(academicPeriodId === period ? ids.filter((id) => id === enrolled) : []);
  },
};

describe('result enrolment check (PRC-M161)', () => {
  let item: AssessmentItemEntity;
  let itemRepo: InMemoryAssessmentItemRepository;
  let schemeRepo: InMemoryGradingSchemeRepository;
  let resultRepo: InMemoryAssessmentResultRepository;

  beforeEach(async () => {
    itemRepo = new InMemoryAssessmentItemRepository();
    schemeRepo = new InMemoryGradingSchemeRepository();
    resultRepo = new InMemoryAssessmentResultRepository();
    const assessment = new AssessmentService(schemeRepo, itemRepo, new InMemoryOutcomeRepository());
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
    });
    [item] = await assessment.defineAssessmentItems(tenantId, {
      subjectId: subject,
      academicPeriodId: period,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
  });

  const service = (mode?: 'enforce' | 'off') =>
    new ResultService(resultRepo, itemRepo, schemeRepo, {
      studentDirectory: directory,
      ...(mode ? { enrolmentCheck: mode } : {}),
    });

  it('defaults to enforce; only "off" disables', () => {
    expect(readEnrolmentCheckMode({})).toBe('enforce');
    expect(readEnrolmentCheckMode({ ASSESSMENT_RESULT_ENROLMENT_CHECK: 'OFF' })).toBe('off');
  });

  it('single entry for a student not enrolled in the period is a 422', async () => {
    const input = { subjectId: subject, academicPeriodId: period, assessmentItemId: item.id };
    await expect(
      service('enforce').enterSingleResult(tenantId, { ...input, studentId: notEnrolled, score: 50 }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      service('enforce').enterSingleResult(tenantId, { ...input, studentId: enrolled, score: 50 }),
    ).resolves.toMatchObject({ studentId: enrolled });
  });

  it('bulk entry reports a row error for the non-enrolled student and saves the rest', async () => {
    const result = await service().enterBulkResults(tenantId, {
      subjectId: subject,
      academicPeriodId: period,
      results: [
        { studentId: enrolled, assessmentItemId: item.id, score: 60 },
        { studentId: notEnrolled, assessmentItemId: item.id, score: 70 },
      ],
    } as never);
    const r = result as unknown as { errors?: Array<{ row: number; field: string }> };
    expect(r.errors?.map((e) => [e.row, e.field])).toEqual([[1, 'studentId']]);
    const saved = await resultRepo.findBySubjectPeriod(tenantId, subject, period);
    expect(saved.map((x) => x.studentId)).toEqual([enrolled]);
  });

  it('off skips the enrolment query', async () => {
    await expect(
      service('off').enterSingleResult(tenantId, {
        subjectId: subject,
        academicPeriodId: period,
        assessmentItemId: item.id,
        studentId: notEnrolled,
        score: 40,
      }),
    ).resolves.toMatchObject({ studentId: notEnrolled });
  });
});
