/**
 * PRC-H053: PUT /examinations must preserve nested subject/center/session/scheme
 * ids and refuse to orphan registrations, marks or published results.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ValidationError } from '@proctira/common';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ExaminationEntity } from './examination-repository.js';
import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { ResultPublicationService } from './result-publication-service.js';
import type { UpdateExaminationInput } from './schemas.js';

const tenantId = randomUUID();

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0] as string;
}

/** Rebuild the full edit form from an entity, as the web UI resends it. */
function fullForm(exam: ExaminationEntity, withIds = true): UpdateExaminationInput {
  return {
    name: exam.name,
    subjects: exam.subjects.map((s) => ({
      ...(withIds ? { id: s.id } : {}),
      name: s.name,
      code: s.code,
      maxScore: s.maxScore,
      gradingSchemeId: s.gradingSchemeId,
    })),
    centers: exam.centers.map((c) => ({
      ...(withIds ? { id: c.id } : {}),
      name: c.name,
      code: c.code,
      institutionId: c.institutionId,
      capacity: c.capacity,
    })),
    gradingSchemes: exam.gradingSchemes.map((g) => ({
      ...(withIds ? { id: g.id } : {}),
      name: g.name,
      minScore: g.minScore,
      maxScore: g.maxScore,
      passThreshold: g.passThreshold,
      thresholds: g.thresholds,
    })),
  };
}

describe('ExaminationService.update id preservation (PRC-H053)', () => {
  let repo: InMemoryExaminationRepository;
  let results: InMemoryResultRepository;
  let service: ExaminationService;
  let publisher: ResultPublicationService;
  let exam: ExaminationEntity;

  beforeEach(async () => {
    repo = new InMemoryExaminationRepository();
    results = new InMemoryResultRepository();
    service = new ExaminationService(repo, results);
    publisher = new ResultPublicationService(repo, results);
    exam = await service.create(tenantId, {
      name: 'Term Exam',
      code: `EX-${randomUUID().slice(0, 8)}`,
      academicPeriodId: randomUUID(),
      startDate: futureDate(14),
      endDate: futureDate(21),
      subjects: [
        { name: 'Maths', code: 'MATH', maxScore: 100 },
        { name: 'English', code: 'ENG', maxScore: 100 },
      ],
      centers: [{ name: 'Main', code: 'C1', institutionId: randomUUID(), capacity: 50 }],
      gradingSchemes: [
        {
          name: 'Std',
          minScore: 0,
          maxScore: 100,
          passThreshold: 40,
          thresholds: [
            { grade: 'A', minScore: 80, maxScore: 100 },
            { grade: 'B', minScore: 40, maxScore: 79 },
            { grade: 'F', minScore: 0, maxScore: 39 },
          ],
        },
      ],
    });
    repo.setStudentEnrollment({
      studentId: 'stu-1',
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: null,
    });
    await service.registerCandidate(tenantId, exam.id, {
      studentId: 'stu-1',
      centerId: exam.centers[0]!.id,
      subjectIds: [exam.subjects[0]!.id],
    });
  });

  it('keeps subject/center/scheme ids unchanged when the full form is resent', async () => {
    const updated = await service.update(tenantId, exam.id, {
      ...fullForm(exam),
      name: 'Term Exam (renamed)',
    });
    expect(updated.subjects.map((s) => s.id)).toEqual(exam.subjects.map((s) => s.id));
    expect(updated.centers.map((c) => c.id)).toEqual(exam.centers.map((c) => c.id));
    expect(updated.gradingSchemes.map((g) => g.id)).toEqual(exam.gradingSchemes.map((g) => g.id));

    await results.upsertCandidates(tenantId, [
      {
        id: randomUUID(),
        examinationId: exam.id,
        studentId: 'stu-1',
        centerId: exam.centers[0]!.id,
        gender: 'other',
        areaId: 'a',
        subjectResults: [
          { candidateId: 'x', subjectId: exam.subjects[0]!.id, score: 85, isComplete: true },
        ],
      },
    ]);
    await repo.update(exam.id, tenantId, { status: 'IN_PROGRESS' });
    const pub = await publisher.publishResults(tenantId, exam.id);
    expect(pub.gradeResults).toHaveLength(1);
    expect(pub.gradeResults[0]!.subjectId).toBe(exam.subjects[0]!.id);
    expect(pub.gradeResults[0]!.grade).toBe('A');
  });

  it('rejects removal of a subject referenced by a registration with 422', async () => {
    const form = fullForm(exam);
    form.subjects = form.subjects!.filter((s) => s.id !== exam.subjects[0]!.id);
    const err = await service.update(tenantId, exam.id, form).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as BusinessRuleError).statusCode).toBe(422);
  });

  it('rejects resending the form without ids once a subject is referenced', async () => {
    await expect(service.update(tenantId, exam.id, fullForm(exam, false))).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('allows removing an unreferenced subject and adding a new one', async () => {
    const form = fullForm(exam);
    form.subjects = [form.subjects![0]!, { name: 'Science', code: 'SCI', maxScore: 50 }];
    const updated = await service.update(tenantId, exam.id, form);
    expect(updated.subjects[0]!.id).toBe(exam.subjects[0]!.id);
    expect(updated.subjects[1]!.id).not.toBe(exam.subjects[1]!.id);
  });

  it('rejects an id that does not belong to the examination', async () => {
    const form = fullForm(exam);
    form.subjects![0] = { ...form.subjects![0]!, id: randomUUID() };
    await expect(service.update(tenantId, exam.id, form)).rejects.toBeInstanceOf(ValidationError);
  });

  it('blocks structural edits while IN_PROGRESS but allows a no-op resend', async () => {
    await repo.update(exam.id, tenantId, { status: 'IN_PROGRESS' });
    await expect(service.update(tenantId, exam.id, fullForm(exam))).resolves.toBeDefined();
    const form = fullForm(exam);
    form.subjects![1] = { ...form.subjects![1]!, maxScore: 80 };
    await expect(service.update(tenantId, exam.id, form)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('property: publish output is identical before and after a no-op PUT', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async (score) => {
        results.clear();
        await repo.update(exam.id, tenantId, { status: 'IN_PROGRESS' });
        await results.upsertCandidates(tenantId, [
          {
            id: 'cand-1',
            examinationId: exam.id,
            studentId: 'stu-1',
            centerId: exam.centers[0]!.id,
            gender: 'other',
            areaId: 'a',
            subjectResults: [
              { candidateId: 'cand-1', subjectId: exam.subjects[0]!.id, score, isComplete: true },
            ],
          },
        ]);
        const before = await publisher.publishResults(tenantId, exam.id);
        await repo.update(exam.id, tenantId, { status: 'SCHEDULED' });
        await service.update(tenantId, exam.id, fullForm(exam));
        await repo.update(exam.id, tenantId, { status: 'IN_PROGRESS' });
        const after = await publisher.publishResults(tenantId, exam.id);
        expect(after.gradeResults).toEqual(before.gradeResults);
        expect(after.incompleteRecords).toEqual(before.incompleteRecords);
      }),
      { numRuns: 25 },
    );
  });
});
