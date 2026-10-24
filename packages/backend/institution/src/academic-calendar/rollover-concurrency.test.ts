/**
 * PRC-M525 — structural smoke test (NOT the failing-first proof; the actual
 * race proof lives in rollover-concurrency.pg.test.ts, gated on live
 * Postgres). The in-memory shim's `ModelTable.create()` has no `await` point
 * inside its critical section, so two racing calls against it cannot
 * actually interleave mid-write (confirmed by reading
 * `in-memory-prisma-lite.ts`'s `ModelTable.create` — fully synchronous
 * between read-check and write). This test documents the sequential-call
 * baseline (already correct today via the existing classKey/targetByKey
 * dedup), not the concurrency guarantee itself.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AcademicPeriodService } from '../academic-period/academic-period-service.js';
import { InMemoryInstitutionRepository } from '../in-memory-repository.js';
import { createInMemoryAcademicsPrisma } from '../education/in-memory-prisma-lite.js';

import { InMemoryCalendarStore } from './calendar-store.js';
import { AcademicCalendarService } from './calendar-service.js';

const TENANT_ID = 't1';

describe('PRC-M525 rollover — sequential re-run dedup baseline', () => {
  it('two sequential (non-concurrent) rollover() calls produce no duplicate class rows', async () => {
    const institutionRepository = new InMemoryInstitutionRepository();
    const prisma = createInMemoryAcademicsPrisma({ institutionRepository });
    const periodService = new AcademicPeriodService({ prisma: prisma as never });
    const calendarService = new AcademicCalendarService({
      prisma: prisma as never,
      store: new InMemoryCalendarStore(),
    });

    const institutionId = randomUUID();
    const source = await periodService.create(TENANT_ID, {
      name: 'Source Year',
      code: 'SRC',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const target = await periodService.create(TENANT_ID, {
      name: 'Target Year',
      code: 'TGT',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    });
    const grade = await (prisma as any).grade.create({
      data: { tenantId: TENANT_ID, name: 'Grade 1', code: 'G1', order: 1 },
    });
    await (prisma as any).class.create({
      data: {
        tenantId: TENANT_ID,
        institutionId,
        gradeId: grade.id,
        academicPeriodId: source.id,
        name: '1-A',
      },
    });

    const first = await calendarService.rollover(
      TENANT_ID,
      source.id,
      { targetPeriodId: target.id, dryRun: false },
      'actor-1',
    );
    expect(first.classes.created).toBe(1);

    const second = await calendarService.rollover(
      TENANT_ID,
      source.id,
      { targetPeriodId: target.id, dryRun: false },
      'actor-1',
    );
    expect(second.classes.created).toBe(0);
    expect(second.classes.existing).toBe(1);

    const targetClasses = await (prisma as any).class.findMany({
      where: { tenantId: TENANT_ID, academicPeriodId: target.id },
    });
    expect(targetClasses).toHaveLength(1);
  });
});
