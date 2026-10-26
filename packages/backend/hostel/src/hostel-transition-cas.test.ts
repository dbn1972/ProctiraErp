/**
 * PRC-L116: leave / visitor / gate-pass transitions are compare-and-set on the
 * status that was read, so two concurrent decisions cannot both succeed
 * (lost update). PG adds the status predicate to the UPDATE.
 */
import { ConflictError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { HostelService } from './hostel-service.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';
import { PgHostelRepository } from './pg-hostel-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT = '33333333-3333-4333-8333-333333333333';

async function setup() {
  const repo = new InMemoryHostelRepository();
  const service = new HostelService(repo);
  const hostel = await service.createHostel(TENANT, { name: 'North', code: 'NH-1' });
  return { repo, service, hostel };
}

function expectOneWinner(results: PromiseSettledResult<{ status: string }>[]) {
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<{ status: string }> => r.status === 'fulfilled',
  );
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
  return fulfilled[0]!.value.status;
}

describe('hostel status transitions are compare-and-set (PRC-L116)', () => {
  it('two concurrent leave decisions: exactly one wins and the stored status matches it', async () => {
    const { repo, service, hostel } = await setup();
    const leave = await service.createLeave(TENANT, {
      studentId: STUDENT,
      hostelId: hostel.id,
      startDate: '2026-09-10',
      endDate: '2026-09-12',
    });
    const winner = expectOneWinner(
      await Promise.allSettled([
        service.decideLeave(TENANT, leave.id, 'approved'),
        service.decideLeave(TENANT, leave.id, 'rejected'),
      ]),
    );
    expect((await repo.findLeaveById(leave.id, TENANT))?.status).toBe(winner);
  });

  it('two concurrent visitor transitions from expected: exactly one wins', async () => {
    const { repo, service, hostel } = await setup();
    const visitor = await service.createVisitor(TENANT, {
      hostelId: hostel.id,
      visitorName: 'Guest',
      studentId: STUDENT,
      visitDate: '2026-09-10',
    });
    const winner = expectOneWinner(
      await Promise.allSettled([
        service.updateVisitorStatus(TENANT, visitor.id, 'checked_in'),
        service.updateVisitorStatus(TENANT, visitor.id, 'denied'),
      ]),
    );
    expect((await repo.findVisitorById(visitor.id, TENANT))?.status).toBe(winner);
  });

  it('two concurrent gate-pass decisions: exactly one wins', async () => {
    const { repo, service, hostel } = await setup();
    const pass = await service.requestGatePass(TENANT, {
      hostelId: hostel.id,
      studentId: STUDENT,
      expectedOutAt: '2026-09-10T08:00:00.000Z',
      expectedInAt: '2026-09-10T20:00:00.000Z',
    });
    const winner = expectOneWinner(
      await Promise.allSettled([
        service.transitionGatePass(TENANT, pass.id, 'approved', 'warden-1'),
        service.transitionGatePass(TENANT, pass.id, 'rejected', 'warden-2'),
      ]),
    );
    expect((await repo.findGatePassById(pass.id, TENANT))?.status).toBe(winner);
  });

  it('a sequential repeat still gets the existing 409 message', async () => {
    const { service, hostel } = await setup();
    const leave = await service.createLeave(TENANT, {
      studentId: STUDENT,
      hostelId: hostel.id,
      startDate: '2026-09-10',
      endDate: '2026-09-12',
    });
    await service.decideLeave(TENANT, leave.id, 'approved');
    await expect(service.decideLeave(TENANT, leave.id, 'rejected')).rejects.toThrow(
      'Leave is already approved',
    );
  });
});

describe('PG updates carry the expected-status predicate (PRC-L116)', () => {
  function fakePool() {
    const statements: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        statements.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client, query: client.query } as never;
    const repo = new PgHostelRepository(pool);
    (repo as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => undefined;
    const updates = () => statements.filter((st) => /^\s*UPDATE /.test(st.text));
    return { repo, updates };
  }

  it('updateLeave binds the expected status', async () => {
    const { repo, updates } = fakePool();
    await repo.updateLeave('l1', TENANT, { status: 'approved' }, 'pending');
    expect(updates()[0]!.text).toContain('AND status = $4');
    expect(updates()[0]!.values).toEqual(['approved', 'l1', TENANT, 'pending']);
  });

  it('updateVisitor binds the expected status', async () => {
    const { repo, updates } = fakePool();
    await repo.updateVisitor('v1', TENANT, { status: 'checked_in' }, 'expected');
    expect(updates()[0]!.text).toContain('AND status = $4');
    expect(updates()[0]!.values).toEqual(['checked_in', 'v1', TENANT, 'expected']);
  });

  it('updateGatePass binds the expected status', async () => {
    const { repo, updates } = fakePool();
    await repo.updateGatePass('g1', TENANT, { status: 'approved', decidedBy: 'w1' }, 'pending');
    const update = updates()[0]!;
    expect(update.text).toContain('AND status = $5');
    expect(update.values).toEqual(['approved', 'w1', 'g1', TENANT, 'pending']);
  });

  it('without an expected status the UPDATE is unchanged', async () => {
    const { repo, updates } = fakePool();
    await repo.updateLeave('l1', TENANT, { status: 'cancelled' });
    expect(updates()[0]!.text).not.toContain('AND status');
    expect(updates()[0]!.values).toEqual(['cancelled', 'l1', TENANT]);
  });
});
