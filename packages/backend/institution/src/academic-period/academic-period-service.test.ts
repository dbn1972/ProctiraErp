/**
 * PRC-L122 — unit tests for AcademicPeriodService against the in-memory
 * academics Prisma shim:
 *  - overlapping academic-year windows are rejected on create
 *  - archiving a year cascades archive to its still-active child terms
 */
import { describe, expect, it } from 'vitest';

import { ConflictError } from '@proctira/common';

import { AcademicPeriodService } from './academic-period-service.js';
import { createInMemoryAcademicsPrisma } from '../education/in-memory-prisma-lite.js';

describe('PRC-L122 academic year overlap + archive cascade', () => {
  it('rejects a new academic year whose window overlaps an existing year', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });

    await expect(
      service.create('t1', {
        name: 'AY 2025-26',
        code: 'AY2526',
        startDate: '2025-06-01',
        endDate: '2026-05-31',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows a new academic year whose window does not overlap an existing year', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });

    const next = await service.create('t1', {
      name: 'AY 2026',
      code: 'AY26',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(next.code).toBe('AY26');
  });

  it('does not reject overlap against years in a different tenant', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });

    const next = await service.create('t2', {
      name: 'AY 2025 (tenant 2)',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    expect(next.code).toBe('AY25');
  });

  it('cascades archive to a still-active child term when its year is archived', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    const year = await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    const term = await service.create('t1', {
      name: 'Term 1',
      code: 'AY25-T1',
      kind: 'term',
      parentId: year.id,
      startDate: '2025-01-01',
      endDate: '2025-06-30',
    });
    expect(term.status).toBe('active');

    await service.update('t1', year.id, { status: 'archived' });

    const archivedTerm = await service.getById('t1', term.id);
    expect(archivedTerm.status).toBe('archived');
  });

  it('leaves an already-archived child term untouched (idempotent) when its year is archived', async () => {
    const prisma = createInMemoryAcademicsPrisma();
    const service = new AcademicPeriodService({ prisma: prisma as never });
    const year = await service.create('t1', {
      name: 'AY 2025',
      code: 'AY25',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    const term = await service.create('t1', {
      name: 'Term 1',
      code: 'AY25-T1',
      kind: 'term',
      parentId: year.id,
      startDate: '2025-01-01',
      endDate: '2025-06-30',
      status: 'archived',
    });
    expect(term.status).toBe('archived');

    await service.update('t1', year.id, { status: 'archived' });

    const stillArchivedTerm = await service.getById('t1', term.id);
    expect(stillArchivedTerm.status).toBe('archived');
  });
});
