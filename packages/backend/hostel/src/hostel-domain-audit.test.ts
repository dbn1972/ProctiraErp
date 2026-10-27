/**
 * PRC-L317 (failing-first, audit): hostel mutations — bed assignment, leave decisions, gate
 * passes, visitor check-in/out and fee-structure creation — each emit one domain audit entry
 * through the injected `auditSink`, carrying tenantId, actorId, entityType, entityId and action.
 * Without a sink, behaviour is unchanged.
 */
import { describe, expect, it } from 'vitest';

import { type HostelAuditEntry, HostelService } from './hostel-service.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const WARDEN = 'warden-1';

function harness() {
  const entries: HostelAuditEntry[] = [];
  const service = new HostelService(new InMemoryHostelRepository(), null, {
    auditSink: async (entry) => {
      entries.push(entry);
    },
  });
  return { service, entries };
}

function only(entries: HostelAuditEntry[], action: string): HostelAuditEntry {
  const matching = entries.filter((e) => e.action === action);
  expect(matching, `audit entries for ${action}`).toHaveLength(1);
  const entry = matching[0]!;
  expect(entry.tenantId).toBe(TENANT);
  expect(entry.actorId).toBe(WARDEN);
  expect(entry.entityType).toBeTruthy();
  expect(entry.entityId).toBeTruthy();
  return entry;
}

async function seed(service: HostelService) {
  const hostel = await service.createHostel(TENANT, { name: 'North', code: 'NH-1' });
  const block = await service.createBlock(TENANT, { hostelId: hostel.id, name: 'A', floor: 1 });
  const room = await service.createRoom(TENANT, { blockId: block.id, roomNumber: '101' });
  const bed = await service.createBed(TENANT, { roomId: room.id, bedLabel: 'B1' });
  return { hostel, bed };
}

describe('PRC-L317 hostel domain audit', () => {
  it('audits a bed assignment', async () => {
    const { service, entries } = harness();
    const { bed } = await seed(service);
    const assignment = await service.createAssignment(
      TENANT,
      { studentId: STUDENT, bedId: bed.id, startDate: '2026-07-01' },
      WARDEN,
    );
    const entry = only(entries, 'bed_assignment.create');
    expect(entry.entityId).toBe(assignment.id);
    expect(entry.after).toMatchObject({ bedId: bed.id, studentId: STUDENT, isActive: true });
  });

  it('audits a leave decision with before/after status', async () => {
    const { service, entries } = harness();
    const { hostel } = await seed(service);
    const leave = await service.createLeave(TENANT, {
      studentId: STUDENT,
      hostelId: hostel.id,
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });
    await service.decideLeave(TENANT, leave.id, 'approved', WARDEN);
    const entry = only(entries, 'leave.decide');
    expect(entry.entityId).toBe(leave.id);
    expect(entry.before).toMatchObject({ status: 'pending' });
    expect(entry.after).toMatchObject({ status: 'approved' });
  });

  it('audits gate-pass request and each transition', async () => {
    const { service, entries } = harness();
    const { hostel } = await seed(service);
    const pass = await service.requestGatePass(
      TENANT,
      {
        hostelId: hostel.id,
        studentId: STUDENT,
        expectedOutAt: '2026-09-10T08:00:00.000Z',
        expectedInAt: '2026-09-10T20:00:00.000Z',
      },
      WARDEN,
    );
    expect(only(entries, 'gate_pass.request').entityId).toBe(pass.id);
    await service.transitionGatePass(TENANT, pass.id, 'approved', WARDEN);
    await service.transitionGatePass(TENANT, pass.id, 'out', WARDEN);
    const transitions = entries.filter((e) => e.action === 'gate_pass.transition');
    expect(transitions.map((e) => [e.before?.['status'], e.after?.['status']])).toEqual([
      ['pending', 'approved'],
      ['approved', 'out'],
    ]);
    expect(transitions.every((e) => e.actorId === WARDEN && e.entityId === pass.id)).toBe(true);
  });

  it('audits visitor check-in and check-out', async () => {
    const { service, entries } = harness();
    const { hostel } = await seed(service);
    const visitor = await service.createVisitor(TENANT, {
      hostelId: hostel.id,
      visitorName: 'Visitor',
      studentId: STUDENT,
      visitDate: '2026-07-01',
    });
    await service.updateVisitorStatus(TENANT, visitor.id, 'checked_in', WARDEN);
    await service.updateVisitorStatus(TENANT, visitor.id, 'checked_out', WARDEN);
    const changes = entries.filter((e) => e.action === 'visitor.status');
    expect(changes.map((e) => e.after?.['status'])).toEqual(['checked_in', 'checked_out']);
    expect(changes.every((e) => e.actorId === WARDEN && e.entityId === visitor.id)).toBe(true);
  });

  it('audits fee-structure creation', async () => {
    const { service, entries } = harness();
    const { hostel } = await seed(service);
    const row = await service.createFeeStructure(
      TENANT,
      { hostelId: hostel.id, roomType: 'double', termLabel: 'T1', amountCents: 50_000 },
      WARDEN,
    );
    const entry = only(entries, 'fee_structure.create');
    expect(entry.entityId).toBe(row.id);
    expect(entry.after).toMatchObject({ amountCents: 50_000, roomType: 'double' });
  });

  it('without a sink, the same flows succeed unchanged', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const { hostel } = await seed(service);
    const leave = await service.createLeave(TENANT, {
      studentId: STUDENT,
      hostelId: hostel.id,
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });
    await expect(service.decideLeave(TENANT, leave.id, 'rejected')).resolves.toMatchObject({
      status: 'rejected',
    });
  });
});
