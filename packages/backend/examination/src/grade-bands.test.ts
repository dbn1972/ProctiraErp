/**
 * PRC-H054 — grade band lookup and grading-scheme band validation.
 *
 * - Grade = band with the greatest minScore <= score (no silent lowest-grade fallback).
 * - Scores outside the scheme range (or matching no band) are flagged incomplete.
 * - Schemes whose bands leave a gap, overlap, or do not cover [minScore, maxScore]
 *   are rejected with 422 (BusinessRuleError).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { BusinessRuleError } from '@proctira/common';

import { ExaminationService, validateGradeBands } from './examination-service.js';
import { calculateGrade, ResultPublicationService } from './result-publication-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import type { ExaminationEntity, ExaminationGradingScheme } from './examination-repository.js';
import type { CreateExaminationInput } from './schemas.js';

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0] as string;
}

const TENANT = '11111111-1111-4111-8111-111111111111';

function scheme(
  thresholds: ExaminationGradingScheme['thresholds'],
  overrides: Partial<ExaminationGradingScheme> = {},
): ExaminationGradingScheme {
  return {
    id: 'scheme-1',
    examinationId: 'exam-1',
    name: 'Standard',
    minScore: 0,
    maxScore: 100,
    passThreshold: 40,
    thresholds,
    ...overrides,
  };
}

const ABF = [
  { grade: 'A', minScore: 90, maxScore: 100 },
  { grade: 'B', minScore: 80, maxScore: 89 },
  { grade: 'F', minScore: 0, maxScore: 79 },
];

function createInput(thresholds: ExaminationGradingScheme['thresholds']): CreateExaminationInput {
  return {
    name: 'Band Exam',
    code: `BAND-${Math.random().toString(36).slice(2)}`,
    academicPeriodId: '22222222-2222-4222-8222-222222222222',
    startDate: futureDate(14),
    endDate: futureDate(21),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [
      {
        name: 'Center A',
        code: 'CTR-A',
        institutionId: '33333333-3333-4333-8333-333333333333',
        capacity: 100,
      },
    ],
    gradingSchemes: [
      { name: 'Standard', minScore: 0, maxScore: 100, passThreshold: 40, thresholds },
    ],
  };
}

describe('calculateGrade (PRC-H054)', () => {
  it('scheme 0-100 with bands 90-100/80-89: score 89.5 -> B, not F', () => {
    expect(calculateGrade(89.5, scheme(ABF))).toBe('B');
  });

  it('uses greatest minScore <= score at band edges', () => {
    const s = scheme(ABF);
    expect(calculateGrade(90, s)).toBe('A');
    expect(calculateGrade(100, s)).toBe('A');
    expect(calculateGrade(79.99, s)).toBe('F');
    expect(calculateGrade(0, s)).toBe('F');
  });

  it('returns null (incomplete) for scores outside the scheme range instead of the lowest grade', () => {
    const s = scheme(ABF);
    expect(calculateGrade(-1, s)).toBeNull();
    expect(calculateGrade(100.5, s)).toBeNull();
  });

  it('returns null when no band covers the score (legacy gapped scheme) — no lowest-grade fallback', () => {
    const s = scheme([{ grade: 'A', minScore: 50, maxScore: 100 }]);
    expect(calculateGrade(10, s)).toBeNull();
  });
});

describe('validateGradeBands (PRC-H054)', () => {
  it('accepts contiguous integer-edge bands in any order', () => {
    expect(validateGradeBands(scheme(ABF))).toEqual([]);
  });

  it('rejects a gap between bands', () => {
    const errs = validateGradeBands(
      scheme([
        { grade: 'A', minScore: 90, maxScore: 100 },
        { grade: 'B', minScore: 70, maxScore: 85 },
        { grade: 'F', minScore: 0, maxScore: 69 },
      ]),
    );
    expect(errs.join(' ')).toMatch(/gap/i);
  });

  it('rejects overlapping bands', () => {
    const errs = validateGradeBands(
      scheme([
        { grade: 'A', minScore: 85, maxScore: 100 },
        { grade: 'B', minScore: 60, maxScore: 90 },
        { grade: 'F', minScore: 0, maxScore: 59 },
      ]),
    );
    expect(errs.join(' ')).toMatch(/overlap/i);
  });

  it('rejects bands that do not cover the scheme minimum or maximum', () => {
    expect(
      validateGradeBands(scheme([{ grade: 'A', minScore: 50, maxScore: 100 }])).join(' '),
    ).toMatch(/minimum/i);
    expect(
      validateGradeBands(scheme([{ grade: 'A', minScore: 0, maxScore: 90 }])).join(' '),
    ).toMatch(/maximum/i);
  });
});

describe('ExaminationService grading-scheme bands (PRC-H054)', () => {
  let repo: InMemoryExaminationRepository;
  let service: ExaminationService;

  beforeEach(() => {
    repo = new InMemoryExaminationRepository();
    service = new ExaminationService(repo);
  });

  it('create with a gap -> 422 BusinessRuleError', async () => {
    const err = await service
      .create(
        TENANT,
        createInput([
          { grade: 'A', minScore: 90, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 70 },
        ]),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as BusinessRuleError).statusCode).toBe(422);
  });

  it('create with an overlap -> 422 BusinessRuleError', async () => {
    const err = await service
      .create(
        TENANT,
        createInput([
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 85 },
        ]),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as BusinessRuleError).statusCode).toBe(422);
  });

  it('update with a gapped scheme -> 422 BusinessRuleError', async () => {
    const created = await service.create(TENANT, createInput(ABF));
    await expect(
      service.update(TENANT, created.id, {
        gradingSchemes: [
          {
            name: 'Gapped',
            minScore: 0,
            maxScore: 100,
            passThreshold: 40,
            thresholds: [
              { grade: 'A', minScore: 90, maxScore: 100 },
              { grade: 'F', minScore: 0, maxScore: 50 },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('create with contiguous bands succeeds', async () => {
    await expect(service.create(TENANT, createInput(ABF))).resolves.toBeDefined();
  });
});

describe('publishResults with fractional scores (PRC-H054)', () => {
  it('89.5 is graded B and a legacy gapped scheme flags incomplete instead of lowest grade', async () => {
    const examRepo = new InMemoryExaminationRepository();
    const resultRepo = new InMemoryResultRepository();
    const svc = new ResultPublicationService(examRepo, resultRepo);
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
          id: 's1',
          examinationId: 'exam-1',
          name: 'M',
          code: 'M',
          maxScore: 100,
          gradingSchemeId: 'scheme-1',
        },
        {
          id: 's2',
          examinationId: 'exam-1',
          name: 'L',
          code: 'L',
          maxScore: 100,
          gradingSchemeId: 'legacy',
        },
      ],
      centers: [],
      sessions: [],
      gradingSchemes: [
        scheme(ABF),
        scheme([{ grade: 'P', minScore: 50, maxScore: 100 }], { id: 'legacy' }),
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await examRepo.create(exam);
    resultRepo.seedCandidates(
      exam.id,
      [
        {
          id: 'c1',
          examinationId: exam.id,
          studentId: 'st1',
          centerId: 'ctr',
          gender: 'male',
          areaId: 'a',
          subjectResults: [
            { candidateId: 'c1', subjectId: 's1', score: 89.5, isComplete: true },
            { candidateId: 'c1', subjectId: 's2', score: 10, isComplete: true },
          ],
        },
      ],
      TENANT,
    );

    const result = await svc.publishResults(TENANT, exam.id);
    expect(result.gradeResults).toHaveLength(1);
    expect(result.gradeResults[0]).toMatchObject({ subjectId: 's1', grade: 'B', passed: true });
    expect(result.incompleteRecords).toHaveLength(1);
    expect(result.incompleteRecords[0]).toMatchObject({ subjectId: 's2' });
  });
});

describe('property: every score in range maps to exactly one grade (PRC-H054)', () => {
  /** Contiguous integer-edge bands built from sorted cut points inside (min, max]. */
  const contiguousScheme = fc
    .record({
      min: fc.integer({ min: 0, max: 50 }),
      span: fc.integer({ min: 5, max: 200 }),
      cuts: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 8 }),
    })
    .map(({ min, span, cuts }) => {
      const max = min + span;
      const edges = [...new Set(cuts.map((c) => min + 1 + Math.floor(c * (span - 1))))].sort(
        (a, b) => a - b,
      );
      const starts = [min, ...edges.filter((e) => e > min && e <= max)];
      const thresholds = starts.map((start, i) => ({
        grade: `G${i}`,
        minScore: start,
        maxScore: i + 1 < starts.length ? starts[i + 1]! - 1 : max,
      }));
      return scheme(thresholds.reverse(), { minScore: min, maxScore: max, passThreshold: min });
    });

  it('validated schemes grade every in-range score with exactly one band', () => {
    fc.assert(
      fc.property(contiguousScheme, fc.double({ min: 0, max: 1, noNaN: true }), (s, t) => {
        expect(validateGradeBands(s)).toEqual([]);
        const score = s.minScore + t * (s.maxScore - s.minScore);
        const grade = calculateGrade(score, s);
        expect(grade).not.toBeNull();
        // exactly one band owns the score under the "greatest minScore <= score" rule
        const sorted = [...s.thresholds].sort((a, b) => a.minScore - b.minScore);
        const owners = sorted.filter((b, i) => {
          const next = sorted[i + 1];
          return score >= b.minScore && (next === undefined || score < next.minScore);
        });
        expect(owners).toHaveLength(1);
        expect(grade).toBe(owners[0]!.grade);
      }),
      { numRuns: 300 },
    );
  });
});
