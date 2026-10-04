/**
 * PRC-H089 — payroll runs must cover every eligible staff member (repositories
 * clamp pageSize to 100) and exclude staff offboarded before the month.
 */
import { randomUUID } from 'node:crypto';
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import type { StaffEntity, StaffFilter } from './staff-repository.js';
import { StaffService } from './staff-service.js';

/** Mirrors PrismaStaffRepository's pageSize clamp (max 100). */
class ClampingStaffRepository extends InMemoryStaffRepository {
  override async list(
    tenantId: string,
    filter: StaffFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffEntity>> {
    const pageSize = Math.max(1, Math.min(pagination.pageSize ?? 20, 100));
    const result = await super.list(tenantId, filter, { ...pagination, pageSize });
    return {
      ...result,
      meta: { ...result.meta, totalPages: Math.max(1, result.meta.totalPages) },
    };
  }
}

function setup() {
  const repo = new ClampingStaffRepository();
  const staffService = new StaffService(repo);
  const hr = new StaffHrService(new InMemoryStaffHrStore(), staffService);
  return { repo, staffService, hr };
}

async function hireMany(staffService: StaffService, tenantId: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = await staffService.create(tenantId, {
      firstName: `Staff${i}`,
      lastName: 'Payroll',
      dateOfBirth: '1985-01-01',
      identityNumber: `PAY-${i}-${randomUUID().slice(0, 6)}`,
      contactPhone: '+15550001',
      position: 'Teacher',
    });
    ids.push(s.id);
  }
  return ids;
}

describe('PRC-H089 payroll headcount', () => {
  it('150 staff -> 150 payroll rows', async () => {
    const tenantId = randomUUID();
    const { staffService, hr } = setup();
    const ids = await hireMany(staffService, tenantId, 150);
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    expect(run.rows).toHaveLength(150);
    expect(new Set(run.rows.map((r) => r.staffId))).toEqual(new Set(ids));
  });

  it('excludes staff offboarded before the month; keeps mid-month offboard', async () => {
    const tenantId = randomUUID();
    const { staffService, hr } = setup();
    const [early, mid, active] = await hireMany(staffService, tenantId, 3);
    await staffService.offboard(tenantId, early!, { effectiveDate: '2026-08-15' }, 'hr-1');
    await staffService.offboard(tenantId, mid!, { effectiveDate: '2026-09-15' }, 'hr-1');
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    const ids = run.rows.map((r) => r.staffId).sort();
    expect(ids).toEqual([mid!, active!].sort());
  });

  it('excludes INACTIVE staff without offboard metadata', async () => {
    const tenantId = randomUUID();
    const { repo, staffService, hr } = setup();
    const [inactive, active] = await hireMany(staffService, tenantId, 2);
    await repo.update(inactive!, tenantId, { status: 'INACTIVE' });
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    expect(run.rows.map((r) => r.staffId)).toEqual([active!]);
  });
});
