/**
 * PRC-L318 — rollover idempotency key is checked before executing, and a
 * dry-run preview never consumes the real run's ledger key.
 */
import { describe, expect, it, vi } from 'vitest';

import { AcademicCalendarService, type RolloverExtras } from './calendar-service.js';
import type { RolloverSummary } from './schemas.js';

function period(id: string, start: string, end: string) {
  return {
    id,
    tenantId: 't1',
    name: id,
    status: 'active',
    startDate: new Date(start),
    endDate: new Date(end),
  };
}

/** Ledger fake honouring the UNIQUE (tenant_id, idempotency_key) ON CONFLICT DO NOTHING. */
function ledger() {
  const rows: Array<{
    tenantId: string;
    idempotencyKey: string | null;
    dryRun: boolean;
    status: string;
    summary: RolloverSummary;
  }> = [];
  const extras: RolloverExtras = {
    recordRolloverRun: vi.fn(async (input) => {
      if (
        input.idempotencyKey &&
        rows.some((r) => r.tenantId === input.tenantId && r.idempotencyKey === input.idempotencyKey)
      ) {
        return; // ON CONFLICT DO NOTHING
      }
      rows.push({
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        dryRun: input.dryRun,
        status: input.status,
        summary: structuredClone(input.summary),
      });
    }),
    findCompletedRolloverRun: vi.fn(async ({ tenantId, idempotencyKey }) => {
      const hit = rows.find(
        (r) =>
          r.tenantId === tenantId &&
          r.idempotencyKey === idempotencyKey &&
          !r.dryRun &&
          r.status === 'completed',
      );
      return hit ? structuredClone(hit.summary) : null;
    }),
  };
  return { rows, extras };
}

function build(extras: RolloverExtras) {
  const sourceClass = { id: 'c1', institutionId: 'i1', gradeId: 'g1', name: 'A', capacity: 30 };
  const prisma = {
    academicPeriod: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'src'
          ? period('src', '2025-04-01', '2026-03-31')
          : where.id === 'tgt'
            ? period('tgt', '2026-04-01', '2027-03-31')
            : where.id === 'other'
              ? period('other', '2027-04-01', '2028-03-31')
              : null,
      ),
    },
    class: {
      findMany: vi.fn(async ({ where }: { where: { academicPeriodId: string } }) =>
        where.academicPeriodId === 'src' ? [sourceClass] : [],
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 'new-class',
      })),
    },
    enrollment: { findMany: vi.fn(async () => []) },
    grade: { findMany: vi.fn(async () => []) },
  };
  const service = new AcademicCalendarService({
    prisma: prisma as never,
    store: {} as never,
    rolloverExtras: extras,
  });
  return { service, prisma };
}

describe('PRC-L318 rollover idempotency', () => {
  it('same key twice → second call returns the first summary and writes nothing', async () => {
    const { rows, extras } = ledger();
    const { service, prisma } = build(extras);
    const dto = { targetPeriodId: 'tgt', dryRun: false, idempotencyKey: 'real-run-key-0001' };

    const first = await service.rollover('t1', 'src', dto, 'user-1');
    expect(first.classes.created).toBe(1);
    expect(prisma.class.create).toHaveBeenCalledTimes(1);

    const second = await service.rollover('t1', 'src', dto, 'user-1');
    expect(second).toEqual(first);
    expect(prisma.class.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it('dry-run then real run with the same key are both recorded', async () => {
    const { rows, extras } = ledger();
    const { service, prisma } = build(extras);
    const key = 'shared-key-00001';

    const preview = await service.rollover(
      't1',
      'src',
      {
        targetPeriodId: 'tgt',
        dryRun: true,
        idempotencyKey: key,
      },
      'user-1',
    );
    expect(preview.classes.created).toBe(0);

    const real = await service.rollover(
      't1',
      'src',
      {
        targetPeriodId: 'tgt',
        dryRun: false,
        idempotencyKey: key,
      },
      'user-1',
    );
    expect(real.classes.created).toBe(1);
    expect(prisma.class.create).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => [r.dryRun, r.status])).toEqual([
      [true, 'dry_run'],
      [false, 'completed'],
    ]);
  });

  it('rejects reuse of a completed key for a different rollover pair with 409', async () => {
    const { extras } = ledger();
    const { service } = build(extras);
    const key = 'pair-bound-key-01';
    await service.rollover(
      't1',
      'src',
      {
        targetPeriodId: 'tgt',
        dryRun: false,
        idempotencyKey: key,
      },
      'user-1',
    );
    await expect(
      service.rollover(
        't1',
        'src',
        {
          targetPeriodId: 'other',
          dryRun: false,
          idempotencyKey: key,
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
