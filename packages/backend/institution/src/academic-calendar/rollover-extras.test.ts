
import { describe, expect, it, vi } from 'vitest';
import { AcademicCalendarService } from './calendar-service.js';

describe('G-905 rollover extras', () => {
  it('passes dryRun into fee/timetable/LMS extras and records the run', async () => {
    const copyFeeStructures = vi.fn(async () => ({ cloned: 2, source: 3 }));
    const copyTimetable = vi.fn(async () => ({ sectionsCloned: 1, meetingsCloned: 4 }));
    const copyLmsAssignments = vi.fn(async () => ({ cloned: 5, source: 5 }));
    const recordRolloverRun = vi.fn(async () => undefined);

    const prisma = {
      academicPeriod: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === 'src') {
            return {
              id: 'src',
              tenantId: 't1',
              name: '2025-26',
              status: 'active',
              startDate: new Date('2025-04-01'),
              endDate: new Date('2026-03-31'),
            };
          }
          return {
            id: 'tgt',
            tenantId: 't1',
            name: '2026-27',
            status: 'planned',
            startDate: new Date('2026-04-01'),
            endDate: new Date('2027-03-31'),
          };
        }),
      },
      class: { findMany: vi.fn(async () => []) },
      enrollment: { findMany: vi.fn(async () => []) },
      grade: { findMany: vi.fn(async () => []) },
    };

    const service = new AcademicCalendarService({
      prisma: prisma as never,
      store: { listByPeriod: vi.fn(), create: vi.fn(), findById: vi.fn(), delete: vi.fn() } as never,
      rolloverExtras: { copyFeeStructures, copyTimetable, copyLmsAssignments, recordRolloverRun },
    });

    const summary = await service.rollover('t1', 'src', {
      targetPeriodId: 'tgt',
      dryRun: true,
      copyFeeStructures: true,
      copyTimetable: true,
      copyLmsAssignments: true,
      idempotencyKey: 'dry-run-key-01',
    });

    expect(copyFeeStructures).toHaveBeenCalledWith('t1', 'rollover', 'src', 'tgt', { dryRun: true });
    expect(copyTimetable).toHaveBeenCalledWith('t1', 'rollover', 'src', 'tgt', { dryRun: true });
    expect(copyLmsAssignments).toHaveBeenCalledWith('t1', 'rollover', 'src', 'tgt', { dryRun: true });
    expect(summary.feeStructures).toEqual({ cloned: 2, source: 3 });
    expect(summary.timetable).toEqual({ sectionsCloned: 1, meetingsCloned: 4 });
    expect(summary.lmsAssignments).toEqual({ cloned: 5, source: 5 });
    expect(recordRolloverRun).toHaveBeenCalledOnce();
  });
});
