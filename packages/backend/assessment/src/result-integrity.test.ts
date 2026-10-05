/**
 * PRC-M161 — results are tied to the item's own subject/period and to students that
 * exist in the tenant. PRC-M164 — bulk entry / subject-wide grades use bounded,
 * set-based queries.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssessmentItemEntity } from './assessment-repository.js';
import { AssessmentService } from './assessment-service.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { bulkUpsertInTx } from './prisma-result-repository.js';
import { InMemoryReportCardDirectory } from './report-card-directory.js';
import { ResultService } from './result-service.js';

// The 2000-student paging test is CPU-heavy; it exceeded vitest's 5s default on a loaded CI
// runner (Unit Tests on #537) while running in well under a second locally.
vi.setConfig({ testTimeout: 30_000 });

const tenantId = 'tenant-m161';
const subjectA = '11111111-1111-4111-8111-111111111111';
const subjectB = '11111111-1111-4111-8111-222222222222';
const periodId = '22222222-2222-4222-8222-222222222222';
const known = '33333333-3333-4333-8333-333333333333';
const unknown = '33333333-3333-4333-8333-444444444444';

describe('ResultService integrity (PRC-M161) and query shape (PRC-M164)', () => {
  let itemRepo: InMemoryAssessmentItemRepository;
  let schemeRepo: InMemoryGradingSchemeRepository;
  let resultRepo: InMemoryAssessmentResultRepository;
  let service: ResultService;
  let itemsA: AssessmentItemEntity[];

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
      thresholds: [
        { grade: 'A', minScore: 50, maxScore: 100 },
        { grade: 'F', minScore: 0, maxScore: 49.99 },
      ],
    });
    itemsA = await assessment.defineAssessmentItems(tenantId, {
      subjectId: subjectA,
      academicPeriodId: periodId,
      gradingSchemeId: scheme.id,
      items: [{ name: 'Exam', weight: 100, minScore: 0, maxScore: 100 }],
    });
    const directory = new InMemoryReportCardDirectory().addStudent(tenantId, known, 'Known');
    service = new ResultService(resultRepo, itemRepo, schemeRepo, {
      studentDirectory: directory,
    });
  });

  it('rejects a single result whose subjectId differs from the item subject (422)', async () => {
    const err = await service
      .enterSingleResult(tenantId, {
        subjectId: subjectB,
        academicPeriodId: periodId,
        studentId: known,
        assessmentItemId: itemsA[0]!.id,
        score: 70,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as BusinessRuleError).statusCode).toBe(422);
    expect(await resultRepo.findBySubjectPeriod(tenantId, subjectB, periodId)).toHaveLength(0);
  });

  it('rejects a single result for a student unknown to the tenant (404)', async () => {
    await expect(
      service.enterSingleResult(tenantId, {
        subjectId: subjectA,
        academicPeriodId: periodId,
        studentId: unknown,
        assessmentItemId: itemsA[0]!.id,
        score: 70,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('bulk: mismatched item and unknown student are row errors; valid rows still saved', async () => {
    const res = await service.enterBulkResults(tenantId, {
      subjectId: subjectB,
      academicPeriodId: periodId,
      results: [{ studentId: known, assessmentItemId: itemsA[0]!.id, score: 70 }],
    });
    expect(res.successCount).toBe(0);
    expect(res.errors[0]!.field).toBe('assessmentItemId');

    const mixed = await service.enterBulkResults(tenantId, {
      subjectId: subjectA,
      academicPeriodId: periodId,
      results: [
        { studentId: known, assessmentItemId: itemsA[0]!.id, score: 70 },
        { studentId: unknown, assessmentItemId: itemsA[0]!.id, score: 60 },
      ],
    });
    expect(mixed.successCount).toBe(1);
    expect(mixed.errors).toEqual([expect.objectContaining({ row: 1, field: 'studentId' })]);
    const saved = await resultRepo.findBySubjectPeriod(tenantId, subjectA, periodId);
    expect(saved.map((r) => r.studentId)).toEqual([known]);
    expect(saved[0]!.subjectId).toBe(subjectA);
  });

  it('bulk entry looks items up once per call, not once per item', async () => {
    const byId = vi.spyOn(itemRepo, 'findById');
    const bySubject = vi.spyOn(itemRepo, 'findBySubjectAndPeriod');
    await service.enterBulkResults(tenantId, {
      subjectId: subjectA,
      academicPeriodId: periodId,
      results: [{ studentId: known, assessmentItemId: itemsA[0]!.id, score: 70 }],
    });
    expect(byId).not.toHaveBeenCalled();
    expect(bySubject).toHaveBeenCalledTimes(1);
  });

  it('grades for 2000 students use 3 repository queries and support paging', async () => {
    const plain = new ResultService(resultRepo, itemRepo, schemeRepo);
    await resultRepo.bulkUpsert(
      Array.from({ length: 2000 }, (_, i) => ({
        id: `r-${i}`,
        tenantId,
        studentId: `stu-${String(i).padStart(4, '0')}`,
        assessmentItemId: itemsA[0]!.id,
        subjectId: subjectA,
        academicPeriodId: periodId,
        score: i % 100,
      })),
    );
    const spies = [
      vi.spyOn(itemRepo, 'findBySubjectAndPeriod'),
      vi.spyOn(schemeRepo, 'findById'),
      vi.spyOn(resultRepo, 'findBySubjectPeriod'),
      vi.spyOn(resultRepo, 'findByStudentSubjectPeriod'),
    ];
    const all = await plain.calculateAllGrades(tenantId, subjectA, periodId);
    expect(all).toHaveLength(2000);
    const calls = spies.reduce((n, s) => n + s.mock.calls.length, 0);
    expect(calls).toBeLessThanOrEqual(3);
    expect(spies[3]!).not.toHaveBeenCalled();
    // 49.5 falls between 'F' ≤49.99 and 'A' ≥50 bands and still gets a grade.
    expect(all.every((g) => g.grade !== 'Ungraded')).toBe(true);

    const page = await plain.calculateGradesPage(tenantId, subjectA, periodId, {
      page: 2,
      limit: 500,
    });
    expect(page.data).toHaveLength(500);
    expect(page.total).toBe(2000);
    const capped = await plain.calculateGradesPage(tenantId, subjectA, periodId, {
      limit: 10_000,
    });
    expect(capped.data).toHaveLength(500);
  });
});

describe('bulkUpsertInTx (PRC-M164)', () => {
  it('issues one parameterised UNNEST upsert per chunk and dedupes keys', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const tx = {
      $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        const ids = params[1] as string[];
        return ids.map((id, i) => ({
          id,
          tenantId,
          studentId: (params[2] as string[])[i],
          assessmentItemId: (params[3] as string[])[i],
          subjectId: (params[4] as string[])[i],
          academicPeriodId: (params[5] as string[])[i],
          score: String((params[6] as number[])[i]),
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }),
    };
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `id-${i}`,
      tenantId,
      studentId: `s-${i}`,
      assessmentItemId: 'item',
      subjectId: subjectA,
      academicPeriodId: periodId,
      score: i,
    }));
    rows.push({ ...rows[0]!, id: 'dup', score: 99 });
    const out = await bulkUpsertInTx(tx as never, tenantId, rows);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).toContain('UNNEST');
    expect(calls[0]!.sql).toContain('ON CONFLICT (tenant_id, student_id, assessment_item_id)');
    expect(calls[0]!.sql).not.toContain(tenantId);
    expect(out).toHaveLength(1500);
    expect(out.find((r) => r.studentId === 's-0')!.score).toBe(99);

    await expect(
      bulkUpsertInTx(tx as never, tenantId, [{ ...rows[1]!, tenantId: 'other' }]),
    ).rejects.toThrow(/same tenant/);
  });
});
