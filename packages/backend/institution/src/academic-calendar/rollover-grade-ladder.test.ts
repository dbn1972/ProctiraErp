/**
 * PRC-M280 — rollover promotion must not corrupt data when the grade ladder has
 * duplicate or gapped `order` values.
 *
 *  - GradeService.create/update reject a duplicate order (409) so the ladder
 *    cannot be made ambiguous through the API.
 *  - Rollover fails closed (BusinessRuleError) when a duplicate order exists, or
 *    when a non-terminal student has no `order + 1` successor while a higher
 *    grade exists (a gap) — instead of silently graduating or mis-promoting.
 *
 * These tests fail without the guards: the old code built
 * `new Map(order -> id)` (dup collapses) and wrote GRADUATED on a missing
 * successor.
 */
import { BusinessRuleError, ConflictError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { AcademicCalendarService } from './calendar-service.js';
import { GradeService } from '../education/grade-service.js';

const TENANT_ID = 'tenant-280';

describe('PRC-M280 GradeService unique order', () => {
  function mockPrisma() {
    return {
      grade: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as never;
  }

  it('rejects create when another grade already uses the order', async () => {
    const prisma = mockPrisma() as {
      grade: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.grade.findFirst.mockResolvedValue({ id: 'g-existing', order: 2 });
    const service = new GradeService({ prisma: prisma as never });

    await expect(
      service.create(TENANT_ID, { name: 'Grade 2b', code: 'G2B', order: 2 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects update that moves a grade onto an occupied order', async () => {
    const prisma = mockPrisma() as {
      grade: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    };
    // first findFirst = load grade being updated; second = order clash check
    prisma.grade.findFirst
      .mockResolvedValueOnce({ id: 'g1', tenantId: TENANT_ID, code: 'G1', order: 1 })
      .mockResolvedValueOnce({ id: 'g2', order: 2 });
    const service = new GradeService({ prisma: prisma as never });

    await expect(service.update(TENANT_ID, 'g1', { order: 2 })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('PRC-M280 rollover fails closed on bad grade ladder', () => {
  function buildService(grades: Array<{ id: string; order: number }>, enrollmentGradeId: string) {
    const prisma = {
      academicPeriod: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          tenantId: TENANT_ID,
          name: where.id,
          status: where.id === 'src' ? 'active' : 'planned',
          startDate: where.id === 'src' ? new Date('2025-04-01') : new Date('2026-04-01'),
          endDate: where.id === 'src' ? new Date('2026-03-31') : new Date('2027-03-31'),
        })),
      },
      class: { findMany: vi.fn(async () => []), create: vi.fn() },
      enrollment: {
        findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
          where.status === 'ENROLLED'
            ? [
                {
                  id: 'enr-1',
                  studentId: 'stu-1',
                  institutionId: 'inst-1',
                  gradeId: enrollmentGradeId,
                  classId: null,
                  status: 'ENROLLED',
                },
              ]
            : [],
        ),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      grade: { findMany: vi.fn(async () => grades) },
    };
    const service = new AcademicCalendarService({
      prisma: prisma as never,
      store: {
        listByPeriod: vi.fn(),
        create: vi.fn(),
        findById: vi.fn(),
        delete: vi.fn(),
      } as never,
    });
    return { service, prisma };
  }

  const runReal = (service: AcademicCalendarService) =>
    service.rollover(
      TENANT_ID,
      'src',
      { targetPeriodId: 'tgt', dryRun: false, promoteEnrollments: true },
      'actor-1',
    );

  it('refuses when grade order is duplicated', async () => {
    const { service, prisma } = buildService(
      [
        { id: 'g1', order: 1 },
        { id: 'g1b', order: 1 },
        { id: 'g2', order: 2 },
      ],
      'g1',
    );
    await expect(runReal(service)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(prisma.enrollment.create).not.toHaveBeenCalled();
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses (no GRADUATED write) when a gap leaves a non-terminal student without a successor', async () => {
    // ladder 1,2,4 — student in order 2 has no order 3 but order 4 exists.
    const { service, prisma } = buildService(
      [
        { id: 'g1', order: 1 },
        { id: 'g2', order: 2 },
        { id: 'g4', order: 4 },
      ],
      'g2',
    );
    await expect(runReal(service)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.create).not.toHaveBeenCalled();
  });

  it('graduates only the genuine terminal grade', async () => {
    const { service, prisma } = buildService(
      [
        { id: 'g1', order: 1 },
        { id: 'g2', order: 2 },
      ],
      'g2',
    );
    const summary = await runReal(service);
    expect(summary.enrollments.graduating).toBe(1);
    expect(prisma.enrollment.updateMany).toHaveBeenCalledTimes(1);
  });
});
