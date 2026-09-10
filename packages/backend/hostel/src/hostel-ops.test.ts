/**
 * G-921 hostel ops: gate-pass transitions, attendance upsert, tenant isolation.
 */
import { describe, expect, it } from 'vitest';

import { canTransitionGatePass, isOverdueReturn } from './hostel-ops.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';
import { HostelService } from './hostel-service.js';

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440000';
const STUDENT = '33333333-3333-4333-8333-333333333333';

async function seedHostel(service: HostelService, tenantId = TENANT_A) {
  const hostel = await service.createHostel(tenantId, {
    name: 'North',
    code: `NH-${tenantId.slice(0, 8)}`,
  });
  const block = await service.createBlock(tenantId, { hostelId: hostel.id, name: 'A', floor: 1 });
  return { hostel, block };
}

describe('gate pass transitions', () => {
  it('allows pending → approved → out → in and rejects invalid jumps', () => {
    expect(canTransitionGatePass('pending', 'approved')).toBe(true);
    expect(canTransitionGatePass('pending', 'out')).toBe(false);
    expect(canTransitionGatePass('approved', 'in')).toBe(false);
    expect(canTransitionGatePass('out', 'in')).toBe(true);
    expect(isOverdueReturn('out', new Date(Date.now() - 1000))).toBe(true);
    expect(isOverdueReturn('out', new Date(Date.now() + 60_000))).toBe(false);
  });

  it('rejects an invalid transition on the service', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const { hostel } = await seedHostel(service);
    const pass = await service.requestGatePass(TENANT_A, {
      hostelId: hostel.id,
      studentId: STUDENT,
      expectedOutAt: '2026-09-10T08:00:00.000Z',
      expectedInAt: '2026-09-10T20:00:00.000Z',
      reason: 'Clinic',
    });
    await expect(service.transitionGatePass(TENANT_A, pass.id, 'out')).rejects.toThrow(
      /Cannot transition/i,
    );
    const approved = await service.transitionGatePass(TENANT_A, pass.id, 'approved', 'warden-1');
    expect(approved.status).toBe('approved');
    const out = await service.transitionGatePass(TENANT_A, pass.id, 'out');
    expect(out.status).toBe('out');
    expect(out.outAt).not.toBeNull();
    const inn = await service.transitionGatePass(TENANT_A, pass.id, 'in');
    expect(inn.status).toBe('in');
    expect(inn.inAt).not.toBeNull();
  });
});

describe('hostel attendance upsert', () => {
  it('is idempotent for the same block/student/date', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const { block } = await seedHostel(service);
    const first = await service.upsertAttendance(TENANT_A, {
      blockId: block.id,
      studentId: STUDENT,
      onDate: '2026-09-09',
      status: 'present',
    });
    const second = await service.upsertAttendance(TENANT_A, {
      blockId: block.id,
      studentId: STUDENT,
      onDate: '2026-09-09',
      status: 'leave',
      reason: 'Approved leave',
    });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('leave');
    const listed = await service.listAttendance(TENANT_A, block.id, '2026-09-09');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.reason).toBe('Approved leave');
  });
});

describe('hostel ops tenant isolation', () => {
  it('hides mess plans, gate passes, fees, and attendance from another tenant', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const { hostel, block } = await seedHostel(service);
    await service.createMessPlan(TENANT_A, { hostelId: hostel.id, name: 'Veg' });
    await service.requestGatePass(TENANT_A, {
      hostelId: hostel.id,
      studentId: STUDENT,
      expectedOutAt: '2026-09-10T08:00:00.000Z',
      expectedInAt: '2026-09-10T20:00:00.000Z',
    });
    await service.createFeeStructure(TENANT_A, {
      hostelId: hostel.id,
      roomType: 'double',
      termLabel: '2026-T1',
      amountCents: 4000000,
    });
    await service.upsertAttendance(TENANT_A, {
      blockId: block.id,
      studentId: STUDENT,
      onDate: '2026-09-09',
      status: 'present',
    });

    expect(await service.listMessPlans(TENANT_B)).toHaveLength(0);
    expect(await service.listGatePasses(TENANT_B)).toHaveLength(0);
    expect(await service.listFeeStructures(TENANT_B)).toHaveLength(0);
    expect(await service.listAttendance(TENANT_B, block.id, '2026-09-09')).toHaveLength(0);
    expect((await service.summarizeFeeStructures(TENANT_A)).count).toBe(1);
  });
});
