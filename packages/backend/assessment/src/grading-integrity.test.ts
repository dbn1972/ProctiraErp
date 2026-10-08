/**
 * PRC-H034 (incomplete/pro-rated grades), PRC-H035 (scheme-aware overall grade),
 * PRC-H037 (item replace guard / FK backstop), PRC-H038 (scheme in-use block).
 */
import { ConflictError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { AssessmentService } from './assessment-service.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { ResultService } from './result-service.js';
import { computeOverallGradeSummary } from './report-card-service.js';
import type { StudentSubjectResult } from './result-repository.js';

const tenantId = 'tenant-grade-integrity';
const subjectId = '11111111-1111-4111-8111-111111111111';
const periodId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';

function newRepos() {
  return {
    itemRepo: new InMemoryAssessmentItemRepository(),
    schemeRepo: new InMemoryGradingSchemeRepository(),
    resultRepo: new InMemoryAssessmentResultRepository(),
  };
}

describe('PRC-H034: partial entry is pro-rated and flagged incomplete', () => {
  it('reports a 95% midterm (40% weight) as ~95 incomplete, not a failing 38', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 50, maxScore: 100 },
        { grade: 'F', minScore: 0, maxScore: 49.99 },
      ],
    });
    const items = await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [
        { name: 'Midterm', weight: 40, minScore: 0, maxScore: 100 },
        { name: 'Final', weight: 60, minScore: 0, maxScore: 100 },
      ],
    });
    const result = new ResultService(resultRepo, itemRepo, schemeRepo);
    // Only the midterm is entered: 95/100.
    await resultRepo.upsert({
      id: 'r1',
      tenantId,
      studentId,
      assessmentItemId: items.find((i) => i.name === 'Midterm')!.id,
      subjectId,
      academicPeriodId: periodId,
      score: 95,
    });
    const grade = await result.calculateStudentGrade(tenantId, studentId, subjectId, periodId);
    // Pro-rated to the entered weight: 95, not 0.4*95 = 38.
    expect(grade.weightedAverage).toBeCloseTo(95, 1);
    expect(grade.grade).toBe('A');
    expect(grade.complete).toBe(false);
    expect(grade.coverage).toBeCloseTo(0.4, 2);
    expect(grade.missingItemIds).toHaveLength(1);
  });

  it('marks complete when every item is entered', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 50, maxScore: 100 },
        { grade: 'F', minScore: 0, maxScore: 49.99 },
      ],
    });
    const items = await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    const result = new ResultService(resultRepo, itemRepo, schemeRepo);
    await resultRepo.upsert({
      id: 'r1',
      tenantId,
      studentId,
      assessmentItemId: items[0]!.id,
      subjectId,
      academicPeriodId: periodId,
      score: 80,
    });
    const grade = await result.calculateStudentGrade(tenantId, studentId, subjectId, periodId);
    expect(grade.weightedAverage).toBeCloseTo(80, 1);
    expect(grade.complete).toBe(true);
    expect(grade.coverage).toBe(1);
  });
});

describe('PRC-H035: overall grade normalises per-scheme range', () => {
  function subjectResult(partial: {
    subjectId: string;
    weightedAverage: number;
    schemeMinValue: number;
    schemeMaxValue: number;
    complete?: boolean;
  }): StudentSubjectResult {
    return {
      studentId,
      subjectId: partial.subjectId,
      academicPeriodId: periodId,
      itemScores: [],
      weightedAverage: partial.weightedAverage,
      grade: 'X',
      gradeDescriptor: null,
      complete: partial.complete ?? true,
      coverage: 1,
      missingItemIds: [],
      schemeMinValue: partial.schemeMinValue,
      schemeMaxValue: partial.schemeMaxValue,
    };
  }

  it('a 0-10 scheme subject averaging 8.5 yields a passing overall grade, not F', () => {
    const summary = computeOverallGradeSummary([
      subjectResult({
        subjectId: 'subj-cgpa',
        weightedAverage: 8.5,
        schemeMinValue: 0,
        schemeMaxValue: 10,
      }),
    ]);
    // 8.5/10 → 85% → 'B', never 'F'.
    expect(summary.averageScore).toBe(85);
    expect(summary.grade).toBe('B');
    expect(summary.complete).toBe(true);
  });

  it('does not average mixed-scheme subjects raw (normalises each first)', () => {
    const summary = computeOverallGradeSummary([
      subjectResult({ subjectId: 's1', weightedAverage: 9, schemeMinValue: 0, schemeMaxValue: 10 }),
      subjectResult({
        subjectId: 's2',
        weightedAverage: 90,
        schemeMinValue: 0,
        schemeMaxValue: 100,
      }),
    ]);
    // Both normalise to 90% → average 90, not raw (9+90)/2 = 49.5.
    expect(summary.averageScore).toBe(90);
    expect(summary.grade).toBe('A');
  });

  it('flags the card Incomplete when any subject is incomplete', () => {
    const summary = computeOverallGradeSummary([
      subjectResult({
        subjectId: 's1',
        weightedAverage: 9,
        schemeMinValue: 0,
        schemeMaxValue: 10,
        complete: false,
      }),
    ]);
    expect(summary.complete).toBe(false);
    expect(summary.grade).toBe('Incomplete');
    expect(summary.incompleteSubjectIds).toEqual(['s1']);
  });
});

describe('PRC-H037: item replace is blocked once results exist', () => {
  it('redefining items after a result exists returns 409', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
    });
    const items = await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    await resultRepo.upsert({
      id: 'r1',
      tenantId,
      studentId,
      assessmentItemId: items[0]!.id,
      subjectId,
      academicPeriodId: periodId,
      score: 50,
    });
    await expect(
      assessment.defineAssessmentItems(tenantId, {
        subjectId,
        academicPeriodId: periodId,
        gradingSchemeId: scheme.id,
        items: [{ name: 'Exam renamed', weight: 100, minScore: 0, maxScore: 100 }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows redefining items when no results exist', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
    });
    await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    const redefined = await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam v2', weight: 100, minScore: 0, maxScore: 100 }],
    });
    expect(redefined).toHaveLength(1);
    expect(redefined[0]!.name).toBe('Exam v2');
  });
});

describe('PRC-H038: scheme edit/delete is blocked while in use', () => {
  it('deleting an in-use scheme returns 409', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
    });
    await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    await expect(assessment.deleteGradingScheme(tenantId, scheme.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('editing thresholds of a scheme used by graded results returns 409', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 50, maxScore: 100 },
        { grade: 'F', minScore: 0, maxScore: 49.99 },
      ],
    });
    const items = await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    await resultRepo.upsert({
      id: 'r1',
      tenantId,
      studentId,
      assessmentItemId: items[0]!.id,
      subjectId,
      academicPeriodId: periodId,
      score: 60,
    });
    await expect(
      assessment.updateGradingScheme(tenantId, scheme.id, {
        thresholds: [
          { grade: 'A', minScore: 70, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 69.99 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows a rename-only update of an in-use scheme', async () => {
    const { itemRepo, schemeRepo, resultRepo } = newRepos();
    const assessment = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const scheme = await assessment.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
    });
    const items = await assessment.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    await resultRepo.upsert({
      id: 'r1',
      tenantId,
      studentId,
      assessmentItemId: items[0]!.id,
      subjectId,
      academicPeriodId: periodId,
      score: 60,
    });
    const updated = await assessment.updateGradingScheme(tenantId, scheme.id, {
      name: 'Percentage Scheme',
    });
    expect(updated.name).toBe('Percentage Scheme');
  });
});
