/**
 * P2-HOSTEL: unique-active-bed / concurrency guard.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { HostelService } from './hostel-service.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';
import { isPgHostelEnabled } from './create-hostel-repository.js';
import { getSharedHostelPool, PgHostelRepository } from './pg-hostel-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440001';
const STUDENT_A = '33333333-3333-4333-8333-333333333333';
const STUDENT_B = '44444444-4444-4444-8444-444444444444';

async function seedBed(service: HostelService, tenantId = TENANT) {
  const hostel = await service.createHostel(tenantId, {
    name: 'North',
    code: `NH-${randomUUID().slice(0, 8)}`,
  });
  const block = await service.createBlock(tenantId, {
    hostelId: hostel.id,
    name: 'A',
    floor: 1,
  });
  const room = await service.createRoom(tenantId, {
    blockId: block.id,
    roomNumber: '101',
    capacity: 2,
  });
  const bed = await service.createBed(tenantId, {
    roomId: room.id,
    bedLabel: 'A',
  });
  const bedB = await service.createBed(tenantId, {
    roomId: room.id,
    bedLabel: 'B',
  });
  return { hostel, block, room, bed, bedB };
}

describe('unique-active-bed concurrency guard (in-memory)', () => {
  it('rejects a second active claim on the same bed', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const { bed } = await seedBed(service);

    await service.createAssignment(TENANT, {
      studentId: STUDENT_A,
      bedId: bed.id,
      startDate: '2026-09-01',
    });

    await expect(
      service.createAssignment(TENANT, {
        studentId: STUDENT_B,
        bedId: bed.id,
        startDate: '2026-09-02',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a second active bed for the same student', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const { bed, bedB } = await seedBed(service);

    await service.createAssignment(TENANT, {
      studentId: STUDENT_A,
      bedId: bed.id,
      startDate: '2026-09-01',
    });

    await expect(
      service.createAssignment(TENANT, {
        studentId: STUDENT_A,
        bedId: bedB.id,
        startDate: '2026-09-02',
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/already has an active bed/i) });
  });

  it('allows only one winner under concurrent claims on one bed', async () => {
    const repo = new InMemoryHostelRepository();
    const service = new HostelService(repo);
    const { bed } = await seedBed(service);

    const outcomes = await Promise.allSettled([
      service.createAssignment(TENANT, {
        studentId: STUDENT_A,
        bedId: bed.id,
        startDate: '2026-09-01',
      }),
      service.createAssignment(TENANT, {
        studentId: STUDENT_B,
        bedId: bed.id,
        startDate: '2026-09-01',
      }),
    ]);

    const ok = outcomes.filter((o) => o.status === 'fulfilled');
    const fail = outcomes.filter((o) => o.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect((fail[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const beds = await service.listBeds(TENANT, bed.roomId);
    expect(beds.find((b) => b.id === bed.id)?.isAvailable).toBe(false);
    const assignments = await service.listAssignments(TENANT);
    expect(assignments.filter((a) => a.isActive && a.bedId === bed.id)).toHaveLength(1);
  });
});

describe('unique-active-bed concurrency guard (live Pg)', () => {
  it.skipIf(!isPgHostelEnabled())(
    'serializes concurrent active claims with FOR UPDATE',
    async () => {
      const pool = getSharedHostelPool();
      expect(pool).not.toBeNull();
      const repo = new PgHostelRepository(pool!);
      const service = new HostelService(repo);
      const tenantId = randomUUID();
      const { bed } = await seedBed(service, tenantId);

      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          service.createAssignment(tenantId, {
            studentId: randomUUID(),
            bedId: bed.id,
            startDate: `2026-09-0${(i % 9) + 1}`,
          }),
        ),
      );

      const ok = outcomes.filter((o) => o.status === 'fulfilled');
      const fail = outcomes.filter((o) => o.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(fail).toHaveLength(4);
      for (const r of fail) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      }

      const assignments = await service.listAssignments(tenantId);
      expect(assignments.filter((a) => a.isActive && a.bedId === bed.id)).toHaveLength(1);
    },
  );
});
