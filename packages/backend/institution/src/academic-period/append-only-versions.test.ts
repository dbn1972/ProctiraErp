import { describe, expect, it } from 'vitest';

import { BusinessRuleError, ConflictError } from '@proctira/common';

import { AcademicPeriodService } from './academic-period-service.js';
import { createInMemoryAcademicsPrisma } from '../education/in-memory-prisma-lite.js';

describe('W1-DATA-07 COMPLETE academic period append-only versions', () => {
  it('rejects date/code mutation on update', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    const created = await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    await expect(
      service.update('t1', created.id, { startDate: '2025-02-01' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(service.update('t1', created.id, { code: 'AY25B' })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('supersede appends a non-overlapping successor and archives the prior', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    const prior = await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    const next = await service.supersede('t1', prior.id, {
      name: 'AY 2025 corrected',
      code: 'AY25',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect((next as { version?: number }).version).toBe(2);
    expect((next as { supersedesId?: string }).supersedesId).toBe(prior.id);
    const archived = await service.getById('t1', prior.id);
    expect(archived.status).toBe('archived');
  });

  it('rejects overlapping successor windows', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    const prior = await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    await expect(
      service.supersede('t1', prior.id, {
        name: 'overlap',
        code: 'AY25',
        startDate: '2025-06-01',
        endDate: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
