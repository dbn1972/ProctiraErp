/**
 * V15-9 — a bed conflict must not leave a fee invoice behind.
 *
 * `createAssignment` posted the allocation invoice before claiming the bed. Those are two
 * transactions in two packages, so when `createActiveAssignment` threw
 * `BedAssignmentConflictError` the invoice had already committed: the caller got a clean
 * 409 and the family was billed for a bed they were never assigned.
 *
 * The invariant asserted here is the one that matters and the one ordering can guarantee
 * outright: **no invoice may exist for an assignment that does not.**
 */
import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { InMemoryHostelFeesPort } from './fees-ledger-port.js';
import { HostelService } from './hostel-service.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440001';
const STUDENT_A = '33333333-3333-4333-8333-333333333333';
const STUDENT_B = '44444444-4444-4444-8444-444444444444';

async function seed(service: HostelService) {
  const hostel = await service.createHostel(TENANT, {
    name: 'North',
    code: `NH-${randomUUID().slice(0, 8)}`,
  });
  const block = await service.createBlock(TENANT, { hostelId: hostel.id, name: 'A', floor: 1 });
  const room = await service.createRoom(TENANT, {
    blockId: block.id,
    roomNumber: '101',
    capacity: 2,
  });
  const bed = await service.createBed(TENANT, { roomId: room.id, bedLabel: 'A' });
  const structure = await service.createFeeStructure(TENANT, {
    hostelId: hostel.id,
    roomType: 'double',
    termLabel: '2026-T1',
    amountCents: 250_000,
    currency: 'INR',
  });
  return { bed, structure };
}

describe('V15-9 allocation invoice ordering', () => {
  it('posts no invoice when the bed is already claimed', async () => {
    const fees = new InMemoryHostelFeesPort();
    const service = new HostelService(new InMemoryHostelRepository(), fees);
    const { bed, structure } = await seed(service);

    // First student takes the bed, and is billed for it.
    await service.createAssignment(TENANT, {
      studentId: STUDENT_A,
      bedId: bed.id,
      startDate: '2026-09-01',
      feeStructureId: structure.id,
    });
    expect(fees.invoices).toHaveLength(1);

    // Second student loses the race.
    await expect(
      service.createAssignment(TENANT, {
        studentId: STUDENT_B,
        bedId: bed.id,
        startDate: '2026-09-02',
        feeStructureId: structure.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // The assertion that fails on the old ordering: still exactly one invoice, and it
    // belongs to the student who actually has the bed.
    expect(fees.invoices).toHaveLength(1);
    expect(fees.invoices.map((i) => i.studentId)).toEqual([STUDENT_A]);
  });

  it('posts no invoice when the student already holds another active bed', async () => {
    // The second guard `createActiveAssignment` enforces, reached through a different
    // branch, so it gets its own arm rather than being assumed equivalent.
    const fees = new InMemoryHostelFeesPort();
    const service = new HostelService(new InMemoryHostelRepository(), fees);
    const { bed, structure } = await seed(service);
    const second = await service.createBed(TENANT, {
      roomId: (await service.listRooms(TENANT))[0]!.id,
      bedLabel: 'B',
    });

    await service.createAssignment(TENANT, {
      studentId: STUDENT_A,
      bedId: bed.id,
      startDate: '2026-09-01',
      feeStructureId: structure.id,
    });
    expect(fees.invoices).toHaveLength(1);

    await expect(
      service.createAssignment(TENANT, {
        studentId: STUDENT_A,
        bedId: second.id,
        startDate: '2026-09-02',
        feeStructureId: structure.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(fees.invoices).toHaveLength(1);
  });

  it('still rejects an unknown fee structure before writing anything', async () => {
    // Validation stayed ahead of the writes; moving the invoice must not turn a bad
    // structure id into a committed assignment.
    const fees = new InMemoryHostelFeesPort();
    const repository = new InMemoryHostelRepository();
    const service = new HostelService(repository, fees);
    const { bed } = await seed(service);

    await expect(
      service.createAssignment(TENANT, {
        studentId: STUDENT_A,
        bedId: bed.id,
        startDate: '2026-09-01',
        feeStructureId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await repository.listAssignments(TENANT)).toHaveLength(0);
    expect(fees.invoices).toHaveLength(0);
  });

  it('still bills the happy path, and returns the invoice with the assignment', async () => {
    const fees = new InMemoryHostelFeesPort();
    const service = new HostelService(new InMemoryHostelRepository(), fees);
    const { bed, structure } = await seed(service);

    const result = await service.createAssignment(TENANT, {
      studentId: STUDENT_A,
      bedId: bed.id,
      startDate: '2026-09-01',
      feeStructureId: structure.id,
    });

    expect(result.invoice).not.toBeNull();
    expect(result.invoice?.amountCents).toBe(250_000);
    expect(fees.invoices).toHaveLength(1);
  });

  it('assigns without an invoice when no fee structure was named', async () => {
    const fees = new InMemoryHostelFeesPort();
    const service = new HostelService(new InMemoryHostelRepository(), fees);
    const { bed } = await seed(service);

    const result = await service.createAssignment(TENANT, {
      studentId: STUDENT_A,
      bedId: bed.id,
      startDate: '2026-09-01',
    });

    expect(result.invoice).toBeNull();
    expect(fees.invoices).toHaveLength(0);
  });
});
