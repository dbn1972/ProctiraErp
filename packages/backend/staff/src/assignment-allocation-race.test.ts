/**
 * PRC-M375: allocation cap is period-aware, atomic, re-checked on
 * re-activation, and delete keeps history.
 */
import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { StaffAssignmentService } from './assignment-service.js';
import type { CreateAssignmentInput } from './assignment-schemas.js';
import { endedFields, InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STAFF = '660e8400-e29b-41d4-a716-446655440001';
let n = 0;
function input(over: Partial<CreateAssignmentInput> = {}): CreateAssignmentInput {
  n += 1;
  return {
    staffId: STAFF,
    institutionId: `770e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`,
    subjectId: '880e8400-e29b-41d4-a716-446655440003',
    classId: '990e8400-e29b-41d4-a716-446655440004',
    role: 'Teacher',
    allocationPercentage: 60,
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    ...over,
  };
}

describe('assignment allocation (PRC-M375)', () => {
  it('two concurrent 60% creates: exactly one succeeds', async () => {
    const service = new StaffAssignmentService(new InMemoryAssignmentRepository());
    const results = await Promise.allSettled([
      service.create(TENANT, input()),
      service.create(TENANT, input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toBeInstanceOf(BusinessRuleError);
  });

  it('only overlapping periods count toward the cap', async () => {
    const service = new StaffAssignmentService(new InMemoryAssignmentRepository());
    await service.create(TENANT, input());
    await expect(
      service.create(TENANT, input({ startDate: '2026-07-01', endDate: '2026-12-31' })),
    ).resolves.toMatchObject({ allocationPercentage: 60 });
  });

  it('re-activation (status only) re-checks the cap', async () => {
    const service = new StaffAssignmentService(new InMemoryAssignmentRepository());
    const a = await service.create(TENANT, input());
    await service.update(TENANT, a.id, { status: 'INACTIVE' });
    await service.create(TENANT, input());
    await expect(service.update(TENANT, a.id, { status: 'ACTIVE' })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('delete ends the assignment and keeps it', async () => {
    const service = new StaffAssignmentService(new InMemoryAssignmentRepository());
    const a = await service.create(
      TENANT,
      input({ startDate: '2020-01-01', endDate: null as never }),
    );
    await service.delete(TENANT, a.id);
    const kept = await service.getById(TENANT, a.id);
    expect(kept.status).toBe('INACTIVE');
    expect(kept.endDate).toBe(new Date().toISOString().slice(0, 10));
    expect(endedFields({ startDate: '2099-01-01', endDate: null }, '2026-01-01')).toEqual({
      status: 'INACTIVE',
      endDate: null,
    });
  });
});
