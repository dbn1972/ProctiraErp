/**
 * PRC-H090: school-scope must actually restrict staff by institution, both for
 * list (read) and for write guards. Before the fix the institutionId filter was
 * silently dropped so a school-bound user saw every school's staff.
 */
import { describe, it, expect } from 'vitest';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';
import type { StaffEntity } from './staff-repository.js';

const TENANT = 'tenant-1';
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';

function baseStaff(id: string): Omit<StaffEntity, 'createdAt' | 'updatedAt'> {
  return {
    id,
    tenantId: TENANT,
    firstName: `F${id}`,
    lastName: `L${id}`,
    identityNumber: `ID-${id}`,
    position: 'teacher',
    status: 'ACTIVE',
    dateOfBirth: '1990-01-01',
    contactPhone: '0000000000',
    contactEmail: null,
    customData: {},
  };
}

async function seedRepo() {
  const repo = new InMemoryStaffRepository();
  await repo.create(baseStaff('a1'));
  await repo.create(baseStaff('a2'));
  await repo.create(baseStaff('b1'));
  repo.addAssignment(TENANT, SCHOOL_A, 'a1');
  repo.addAssignment(TENANT, SCHOOL_A, 'a2');
  repo.addAssignment(TENANT, SCHOOL_B, 'b1');
  return repo;
}

describe('staff school-scope (PRC-H090)', () => {
  it('list with institutionId returns only that school staff', async () => {
    const repo = await seedRepo();
    const result = await repo.list(TENANT, { institutionId: SCHOOL_A }, { page: 1, pageSize: 50 });
    const ids = result.data.map((s) => s.id).sort();
    expect(ids).toEqual(['a1', 'a2']);
    expect(ids).not.toContain('b1');
  });

  it('list without institutionId still returns all staff (tenant-wide admin)', async () => {
    const repo = await seedRepo();
    const result = await repo.list(TENANT, {}, { page: 1, pageSize: 50 });
    expect(result.data.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('findInstitutionIds resolves a staff member assignments', async () => {
    const repo = await seedRepo();
    expect(await repo.findInstitutionIds(TENANT, 'a1')).toEqual([SCHOOL_A]);
    expect(await repo.findInstitutionIds(TENANT, 'b1')).toEqual([SCHOOL_B]);
  });

  it('write guard rejects a target outside the caller institutions (404)', async () => {
    const repo = await seedRepo();
    const service = new StaffService(repo);
    // School-A-bound caller must not be able to write to a School-B staff member.
    await expect(
      service.assertStaffWritableInInstitutions(TENANT, 'b1', [SCHOOL_A]),
    ).rejects.toThrow(/not found/i);
    // Same caller may write to their own school staff.
    await expect(
      service.assertStaffWritableInInstitutions(TENANT, 'a1', [SCHOOL_A]),
    ).resolves.toBeUndefined();
  });

  it('write guard is a no-op for tenant-wide callers (no institution scope)', async () => {
    const repo = await seedRepo();
    const service = new StaffService(repo);
    await expect(
      service.assertStaffWritableInInstitutions(TENANT, 'b1', undefined),
    ).resolves.toBeUndefined();
    await expect(
      service.assertStaffWritableInInstitutions(TENANT, 'b1', []),
    ).resolves.toBeUndefined();
  });
});
