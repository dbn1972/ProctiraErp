/**
 * Unit smoke for Pg hostel repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isPgHostelEnabled } from './create-hostel-repository.js';
import { getSharedHostelPool, PgHostelRepository } from './pg-hostel-repository.js';

describe('PgHostelRepository', () => {
  it.skipIf(!isPgHostelEnabled())('creates hostel structure and assignment', async () => {
    const pool = getSharedHostelPool();
    expect(pool).not.toBeNull();
    const repo = new PgHostelRepository(pool!);
    const tenantId = randomUUID();
    const hostelId = randomUUID();
    const blockId = randomUUID();
    const roomId = randomUUID();
    const bedId = randomUUID();

    await repo.createHostel({
      id: hostelId,
      tenantId,
      name: 'North Hall',
      code: `NH-${hostelId.slice(0, 8)}`,
      address: null,
      capacity: 100,
      status: 'active',
    });
    await repo.createBlock({
      id: blockId,
      tenantId,
      hostelId,
      name: 'A',
      floor: 1,
    });
    await repo.createRoom({
      id: roomId,
      tenantId,
      blockId,
      roomNumber: '101',
      capacity: 2,
    });
    await repo.createBed({
      id: bedId,
      tenantId,
      roomId,
      bedLabel: 'A',
      isAvailable: true,
    });

    const beds = await repo.listBeds(tenantId, roomId);
    expect(beds.some((b) => b.id === bedId)).toBe(true);

    const assignmentId = randomUUID();
    await repo.createAssignment({
      id: assignmentId,
      tenantId,
      studentId: randomUUID(),
      bedId,
      startDate: '2026-09-01',
      endDate: null,
      isActive: true,
    });

    const assignments = await repo.listAssignments(tenantId);
    expect(assignments.some((a) => a.id === assignmentId)).toBe(true);

    // G-710: FORCE RLS + tenant GUC — another tenant sees nothing, and a
    // direct query without the GUC bound sees nothing either.
    const otherTenant = randomUUID();
    expect(await repo.listHostels(otherTenant)).toHaveLength(0);
    expect(await repo.listAssignments(otherTenant)).toHaveLength(0);
    const unscoped = await pool!.query('SELECT id FROM hostels WHERE id = $1', [hostelId]);
    expect(unscoped.rowCount).toBe(0);
  });
});
