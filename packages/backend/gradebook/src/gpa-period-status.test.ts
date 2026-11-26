/**
 * PRC-M268 (topic 9 Option A): GPA by academic period and approved status.
 * - Draft / submitted / rejected grades never count toward GPA.
 * - computeGpa with academicPeriodId uses only that period's sections.
 * - Class rank: term GPA is the section's period, CGPA spans every period.
 * - The grade-point cap comes from the grading scale, not a fixed 10.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { GradebookService } from './gradebook-service.js';
import {
  BOARD,
  SECTION,
  STUDENT,
  STUDENT_B,
  TENANT,
  setupGradebook,
  upsertApprovedGrade,
} from './gradebook-test-setup.js';
import type { InMemoryGradebookRepository } from './in-memory-repository.js';

const PERIOD_1 = '77777777-7777-4777-8777-777777777777';
const PERIOD_2 = '88888888-8888-4888-8888-888888888888';
const SECTION_P2 = '99999999-9999-4999-8999-999999999999';

describe('PRC-M268 GPA by period and approved status', () => {
  let repo: InMemoryGradebookRepository;
  let service: GradebookService;

  beforeEach(() => {
    ({ repo, service } = setupGradebook());
    repo.seedSection({
      id: SECTION_P2,
      tenantId: TENANT,
      institutionId: '66666666-6666-4666-8666-666666666666',
      academicPeriodId: PERIOD_2,
      code: '10-A',
      name: 'Class 10-A (term 2)',
      status: 'PUBLISHED',
    });
  });

  it('ignores draft and submitted grades', async () => {
    await upsertApprovedGrade(service, TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'ENG',
      numericScore: 95,
    });
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 10,
    });
    const submitted = await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'SCI',
      numericScore: 10,
    });
    await service.transitionGradeEntry(TENANT, submitted.id, 'submit');
    const { detail } = await service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD });
    expect(detail.courses.map((c) => c.courseCode)).toEqual(['ENG']);
    expect(detail.weightedGpa).toBe(10);
  });

  it('refuses to compute when no grade is approved', async () => {
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'ENG',
      numericScore: 95,
    });
    await expect(
      service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD }),
    ).rejects.toThrow(/approved/);
  });

  it('restricts computeGpa to the requested academic period', async () => {
    await upsertApprovedGrade(service, TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'ENG',
      numericScore: 95,
    });
    await upsertApprovedGrade(service, TENANT, {
      sectionId: SECTION_P2,
      studentId: STUDENT,
      assessmentCode: 'ENG2',
      numericScore: 85,
    });
    const p1 = await service.computeGpa(TENANT, {
      studentId: STUDENT,
      boardId: BOARD,
      academicPeriodId: PERIOD_1,
    });
    expect(p1.detail.courses.map((c) => c.courseCode)).toEqual(['ENG']);
    expect(p1.snapshot.academicPeriodId).toBe(PERIOD_1);
    const p2 = await service.computeGpa(TENANT, {
      studentId: STUDENT,
      boardId: BOARD,
      academicPeriodId: PERIOD_2,
    });
    expect(p2.detail.courses.map((c) => c.courseCode)).toEqual(['ENG2']);
  });

  it('class rank uses the term for GPA and every period for CGPA', async () => {
    // Term 1 (SECTION): A 95 (10 pts), B 85 (9 pts). Term 2: A 10 (0 pts), B 95 (10 pts).
    for (const [studentId, score] of [
      [STUDENT, 95],
      [STUDENT_B, 85],
    ] as const) {
      await upsertApprovedGrade(service, TENANT, {
        sectionId: SECTION,
        studentId,
        assessmentCode: 'ENG',
        numericScore: score,
      });
    }
    for (const [studentId, score] of [
      [STUDENT, 10],
      [STUDENT_B, 95],
    ] as const) {
      await upsertApprovedGrade(service, TENANT, {
        sectionId: SECTION_P2,
        studentId,
        assessmentCode: 'ENG2',
        numericScore: score,
      });
    }
    const { ranks } = await service.computeClassRank(TENANT, {
      sectionId: SECTION,
      boardId: BOARD,
      persist: false,
    });
    const a = ranks.find((r) => r.studentId === STUDENT)!;
    const b = ranks.find((r) => r.studentId === STUDENT_B)!;
    expect(a.classRank).toBe(1);
    expect(a.weightedGpa).toBe(10);
    expect(a.cgpa).toBe(5);
    expect(b.weightedGpa).toBe(9);
    expect(b.cgpa).toBe(9.5);
  });

  it('caps grade points at the scale maximum, not a fixed 10', async () => {
    const scale = (await repo.listGradingScales(TENANT))[0]!;
    repo.seedScale({
      ...scale,
      id: '55555555-5555-4555-8555-5555555555cc',
      code: 'TWELVE',
      isDefault: false,
      bands: [
        { label: 'X', minPercent: 50, maxPercent: 100, gradePoints: 12 },
        { label: 'F', minPercent: 0, maxPercent: 49.99, gradePoints: 0 },
      ],
    });
    await upsertApprovedGrade(service, TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'ENG',
      numericScore: 95,
    });
    const { detail } = await service.computeGpa(TENANT, {
      studentId: STUDENT,
      gradingScaleId: '55555555-5555-4555-8555-5555555555cc',
    });
    expect(detail.weightedGpa).toBe(12);
  });
});
