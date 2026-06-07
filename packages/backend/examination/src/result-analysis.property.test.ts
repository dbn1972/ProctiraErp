/**
 * Property-Based Test: Examination Result Analysis Accuracy
 *
 * **Validates: Requirements 10.8**
 *
 * Property 24: For any set of examination results, the pass rate SHALL equal
 * passing_count / total_count * 100, the mean score SHALL equal sum_of_scores / count,
 * and score distribution SHALL correctly bucket scores by the defined ranges.
 * Breakdowns by subject, center, gender, and area are consistent with the overall totals.
 * All percentages are rounded to 2 decimal places.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import { ResultPublicationService } from './result-publication-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import type { ExaminationEntity, ExaminationGradingScheme } from './examination-repository.js';
import type { ExaminationCandidate, CandidateGender } from './result-repository.js';

// Helper to round to 2 decimal places (same as production code)
function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}

// Helper to check if a number has at most 2 decimal places
function hasAtMostTwoDecimalPlaces(num: number): boolean {
  return Math.abs(num - roundToTwo(num)) < 1e-10;
}

// Arbitrary for generating a valid UUID-like string
const arbId = fc.hexaString({ minLength: 8, maxLength: 8 }).map((s) => `${s}-0000-4000-8000-000000000000`);

// Arbitrary for gender
const arbGender: fc.Arbitrary<CandidateGender> = fc.constantFrom('male', 'female', 'other');

// Arbitrary for generating a grading scheme with pass threshold
const arbGradingScheme = fc.record({
  minScore: fc.constant(0),
  maxScore: fc.constant(100),
  passThreshold: fc.integer({ min: 1, max: 99 }),
}).map(({ minScore, maxScore, passThreshold }) => {
  const schemeId = `scheme-${Math.random().toString(36).slice(2, 10)}`;
  const scheme: ExaminationGradingScheme = {
    id: schemeId,
    examinationId: '',
    name: 'Test Grading Scheme',
    minScore,
    maxScore,
    passThreshold,
    thresholds: [
      { grade: 'A', minScore: 80, maxScore: 100 },
      { grade: 'B', minScore: 60, maxScore: 79 },
      { grade: 'C', minScore: passThreshold, maxScore: 59 },
      { grade: 'F', minScore: 0, maxScore: passThreshold - 1 },
    ],
  };
  return scheme;
});

// Arbitrary for generating subjects (1-5 subjects)
const arbSubjects = fc.integer({ min: 1, max: 5 }).chain((count) =>
  fc.tuple(
    ...Array.from({ length: count }, (_, i) =>
      fc.constant({ id: `subj-${i}`, name: `Subject ${i}`, code: `S${i}` }),
    ),
  ),
);

// Arbitrary for generating centers (1-3 centers)
const arbCenters = fc.integer({ min: 1, max: 3 }).chain((count) =>
  fc.tuple(
    ...Array.from({ length: count }, (_, i) =>
      fc.constant({ id: `center-${i}`, name: `Center ${i}` }),
    ),
  ),
);

// Arbitrary for generating areas (1-3 areas)
const arbAreas = fc.integer({ min: 1, max: 3 }).chain((count) =>
  fc.tuple(
    ...Array.from({ length: count }, (_, i) => fc.constant(`area-${i}`)),
  ),
);

// Generate a complete test scenario with candidates and scores
interface TestScenario {
  passThreshold: number;
  subjectIds: string[];
  centerIds: string[];
  areaIds: string[];
  candidates: {
    id: string;
    studentId: string;
    centerId: string;
    gender: CandidateGender;
    areaId: string;
    scores: { subjectId: string; score: number }[];
  }[];
}

const arbTestScenario: fc.Arbitrary<TestScenario> = fc
  .record({
    passThreshold: fc.integer({ min: 20, max: 80 }),
    numSubjects: fc.integer({ min: 1, max: 4 }),
    numCenters: fc.integer({ min: 1, max: 3 }),
    numAreas: fc.integer({ min: 1, max: 3 }),
    numCandidates: fc.integer({ min: 1, max: 10 }),
  })
  .chain(({ passThreshold, numSubjects, numCenters, numAreas, numCandidates }) => {
    const subjectIds = Array.from({ length: numSubjects }, (_, i) => `subj-${i}`);
    const centerIds = Array.from({ length: numCenters }, (_, i) => `center-${i}`);
    const areaIds = Array.from({ length: numAreas }, (_, i) => `area-${i}`);

    const candidateArb = fc.record({
      gender: arbGender,
      centerIdx: fc.integer({ min: 0, max: numCenters - 1 }),
      areaIdx: fc.integer({ min: 0, max: numAreas - 1 }),
      scores: fc.array(fc.integer({ min: 0, max: 100 }), {
        minLength: numSubjects,
        maxLength: numSubjects,
      }),
    });

    return fc.array(candidateArb, { minLength: numCandidates, maxLength: numCandidates }).map(
      (candidateData) => {
        const candidates = candidateData.map((c, idx) => ({
          id: `cand-${idx}`,
          studentId: `student-${idx}`,
          centerId: centerIds[c.centerIdx]!,
          gender: c.gender,
          areaId: areaIds[c.areaIdx]!,
          scores: subjectIds.map((subjectId, sIdx) => ({
            subjectId,
            score: c.scores[sIdx]!,
          })),
        }));

        return {
          passThreshold,
          subjectIds,
          centerIds,
          areaIds,
          candidates,
        };
      },
    );
  });

describe('Property 24: Examination Result Analysis Accuracy', () => {
  let service: ResultPublicationService;
  let examRepository: InMemoryExaminationRepository;
  let resultRepository: InMemoryResultRepository;
  const tenantId = 'tenant-prop-test';

  beforeEach(() => {
    examRepository = new InMemoryExaminationRepository();
    resultRepository = new InMemoryResultRepository();
    service = new ResultPublicationService(examRepository, resultRepository);
  });

  /**
   * Helper to set up an examination and candidates from a test scenario,
   * publish results, and generate analysis.
   */
  async function setupAndAnalyze(scenario: TestScenario) {
    const examId = `exam-${Math.random().toString(36).slice(2, 10)}`;
    const schemeId = `scheme-${Math.random().toString(36).slice(2, 10)}`;

    const examination: Omit<ExaminationEntity, 'createdAt' | 'updatedAt'> = {
      id: examId,
      tenantId,
      name: 'Property Test Exam',
      code: `PTE-${Math.random().toString(36).slice(2, 8)}`,
      description: null,
      academicPeriodId: 'period-1',
      startDate: '2025-06-01',
      endDate: '2025-06-15',
      status: 'IN_PROGRESS',
      subjects: scenario.subjectIds.map((id, idx) => ({
        id,
        examinationId: examId,
        name: `Subject ${idx}`,
        code: `S${idx}`,
        maxScore: 100,
        gradingSchemeId: schemeId,
      })),
      centers: scenario.centerIds.map((id, idx) => ({
        id,
        examinationId: examId,
        name: `Center ${idx}`,
        code: `CTR-${idx}`,
        institutionId: `inst-${idx}`,
        capacity: 200,
      })),
      sessions: [],
      gradingSchemes: [
        {
          id: schemeId,
          examinationId: examId,
          name: 'Test Scheme',
          minScore: 0,
          maxScore: 100,
          passThreshold: scenario.passThreshold,
          thresholds: [
            { grade: 'A', minScore: 80, maxScore: 100 },
            { grade: 'B', minScore: 60, maxScore: 79 },
            { grade: 'C', minScore: scenario.passThreshold, maxScore: 59 },
            { grade: 'F', minScore: 0, maxScore: scenario.passThreshold - 1 },
          ],
        },
      ],
    };

    await examRepository.create(examination);

    const candidates: ExaminationCandidate[] = scenario.candidates.map((c) => ({
      id: c.id,
      examinationId: examId,
      studentId: c.studentId,
      centerId: c.centerId,
      gender: c.gender,
      areaId: c.areaId,
      subjectResults: c.scores.map((s) => ({
        candidateId: c.id,
        subjectId: s.subjectId,
        score: s.score,
        isComplete: true,
      })),
    }));

    resultRepository.seedCandidates(examId, candidates);

    // Publish results
    await service.publishResults(tenantId, examId);

    // Generate analysis
    const analysis = await service.generateAnalysis(tenantId, examId);

    return { analysis, scenario, examId };
  }

  it('pass rate is correctly calculated as (passing results / total results) * 100', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        const { analysis } = await setupAndAnalyze(scenario);

        // Calculate expected pass rate
        const allScores = scenario.candidates.flatMap((c) => c.scores.map((s) => s.score));
        const totalResults = allScores.length;
        const passingResults = allScores.filter((s) => s >= scenario.passThreshold).length;
        const expectedPassRate =
          totalResults > 0 ? roundToTwo((passingResults / totalResults) * 100) : 0;

        expect(analysis.overall.passRate).toBe(expectedPassRate);
        expect(analysis.overall.passCount).toBe(passingResults);
        expect(analysis.overall.failCount).toBe(totalResults - passingResults);
      }),
      { numRuns: 50 },
    );
  });

  it('mean score is correctly calculated as sum of scores / count of scores', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        const { analysis } = await setupAndAnalyze(scenario);

        // Calculate expected mean score
        const allScores = scenario.candidates.flatMap((c) => c.scores.map((s) => s.score));
        const totalResults = allScores.length;
        const expectedMean =
          totalResults > 0
            ? roundToTwo(allScores.reduce((sum, s) => sum + s, 0) / totalResults)
            : 0;

        expect(analysis.overall.meanScore).toBe(expectedMean);
      }),
      { numRuns: 50 },
    );
  });

  it('score distribution buckets correctly partition all scores', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        const { analysis } = await setupAndAnalyze(scenario);

        const allScores = scenario.candidates.flatMap((c) => c.scores.map((s) => s.score));
        const totalResults = allScores.length;
        const distribution = analysis.overall.scoreDistribution;

        // All scores must be accounted for in the distribution
        const totalInBuckets = distribution.reduce((sum, bucket) => sum + bucket.count, 0);
        expect(totalInBuckets).toBe(totalResults);

        // Buckets should cover the full range without gaps
        if (distribution.length > 0) {
          // First bucket starts at minScore (0)
          expect(distribution[0]!.minScore).toBe(0);
          // Last bucket ends at maxScore (100)
          expect(distribution[distribution.length - 1]!.maxScore).toBe(100);

          // Buckets should be contiguous (no gaps)
          for (let i = 1; i < distribution.length; i++) {
            // Each bucket's min should be close to the previous bucket's max
            const prevMax = distribution[i - 1]!.maxScore;
            const currMin = distribution[i]!.minScore;
            expect(currMin).toBeCloseTo(prevMax, 0);
          }
        }

        // Each bucket's percentage should be count/total * 100
        for (const bucket of distribution) {
          const expectedPercentage =
            totalResults > 0 ? roundToTwo((bucket.count / totalResults) * 100) : 0;
          expect(bucket.percentage).toBe(expectedPercentage);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('breakdowns by subject, center, gender, and area are consistent with overall totals', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        const { analysis } = await setupAndAnalyze(scenario);

        const overallPassCount = analysis.overall.passCount;
        const overallFailCount = analysis.overall.failCount;
        const overallTotal = overallPassCount + overallFailCount;

        // By Subject: sum of pass+fail across all subjects should equal overall total
        const subjectTotalPass = analysis.bySubject.reduce((sum, b) => sum + b.passCount, 0);
        const subjectTotalFail = analysis.bySubject.reduce((sum, b) => sum + b.failCount, 0);
        expect(subjectTotalPass + subjectTotalFail).toBe(overallTotal);
        expect(subjectTotalPass).toBe(overallPassCount);
        expect(subjectTotalFail).toBe(overallFailCount);

        // By Center: sum of pass+fail across all centers should equal overall total
        const centerTotalPass = analysis.byCenter.reduce((sum, b) => sum + b.passCount, 0);
        const centerTotalFail = analysis.byCenter.reduce((sum, b) => sum + b.failCount, 0);
        expect(centerTotalPass + centerTotalFail).toBe(overallTotal);
        expect(centerTotalPass).toBe(overallPassCount);
        expect(centerTotalFail).toBe(overallFailCount);

        // By Gender: sum of pass+fail across all genders should equal overall total
        const genderTotalPass = analysis.byGender.reduce((sum, b) => sum + b.passCount, 0);
        const genderTotalFail = analysis.byGender.reduce((sum, b) => sum + b.failCount, 0);
        expect(genderTotalPass + genderTotalFail).toBe(overallTotal);
        expect(genderTotalPass).toBe(overallPassCount);
        expect(genderTotalFail).toBe(overallFailCount);

        // By Area: sum of pass+fail across all areas should equal overall total
        const areaTotalPass = analysis.byArea.reduce((sum, b) => sum + b.passCount, 0);
        const areaTotalFail = analysis.byArea.reduce((sum, b) => sum + b.failCount, 0);
        expect(areaTotalPass + areaTotalFail).toBe(overallTotal);
        expect(areaTotalPass).toBe(overallPassCount);
        expect(areaTotalFail).toBe(overallFailCount);
      }),
      { numRuns: 50 },
    );
  });

  it('all percentages are rounded to 2 decimal places', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        const { analysis } = await setupAndAnalyze(scenario);

        // Check overall pass rate
        expect(hasAtMostTwoDecimalPlaces(analysis.overall.passRate)).toBe(true);
        expect(hasAtMostTwoDecimalPlaces(analysis.overall.meanScore)).toBe(true);

        // Check overall score distribution percentages
        for (const bucket of analysis.overall.scoreDistribution) {
          expect(hasAtMostTwoDecimalPlaces(bucket.percentage)).toBe(true);
        }

        // Check all breakdown pass rates and mean scores
        const allBreakdowns = [
          ...analysis.bySubject,
          ...analysis.byCenter,
          ...analysis.byGender,
          ...analysis.byArea,
        ];

        for (const breakdown of allBreakdowns) {
          expect(hasAtMostTwoDecimalPlaces(breakdown.passRate)).toBe(true);
          expect(hasAtMostTwoDecimalPlaces(breakdown.meanScore)).toBe(true);

          // Check score distribution percentages within breakdowns
          for (const bucket of breakdown.scoreDistribution) {
            expect(hasAtMostTwoDecimalPlaces(bucket.percentage)).toBe(true);
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
