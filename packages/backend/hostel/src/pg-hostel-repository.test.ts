/**
 * Unit smoke for Pg hostel repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
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
    const studentId = randomUUID();
    await ensurePgTestStudent(pool!, tenantId, studentId);

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
      studentId,
      bedId,
      startDate: '2026-09-01',
      endDate: null,
      isActive: true,
    });

    const assignmentPage = await repo.listAssignments(tenantId, { page: 1, pageSize: 100 });
    expect(assignmentPage.data.some((a) => a.id === assignmentId)).toBe(true);
    expect(assignmentPage.meta).toEqual({ page: 1, pageSize: 100, totalItems: 1, totalPages: 1 });

    // PRC-M278: leaves/visitors page with COUNT + LIMIT/OFFSET in SQL.
    for (let i = 1; i <= 3; i++) {
      await repo.createLeave({
        id: randomUUID(),
        tenantId,
        studentId,
        hostelId,
        startDate: `2026-10-0${i}`,
        endDate: `2026-10-0${i + 1}`,
        reason: null,
        status: 'pending',
      });
      await repo.createVisitor({
        id: randomUUID(),
        tenantId,
        hostelId,
        visitorName: `Visitor ${i}`,
        studentId,
        visitDate: `2026-10-0${i}`,
        status: 'expected',
      });
    }
    for (const list of [repo.listLeaves.bind(repo), repo.listVisitors.bind(repo)]) {
      const first = await list(tenantId, { page: 1, pageSize: 2 });
      const second = await list(tenantId, { page: 2, pageSize: 2 });
      expect(first.data).toHaveLength(2);
      expect(first.meta).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
      expect(second.data).toHaveLength(1);
      expect(first.data.map((r) => r.id)).not.toContain(second.data[0]!.id);
    }

    // G-710: FORCE RLS + tenant GUC — another tenant sees nothing, and a
    // direct query without the GUC bound sees nothing either.
    const otherTenant = randomUUID();
    const none = { page: 1, pageSize: 100 };
    expect(await repo.listHostels(otherTenant)).toHaveLength(0);
    expect((await repo.listAssignments(otherTenant, none)).meta.totalItems).toBe(0);
    expect((await repo.listLeaves(otherTenant, none)).meta.totalItems).toBe(0);
    expect((await repo.listVisitors(otherTenant, none)).meta.totalItems).toBe(0);
    const unscoped = await pool!.query('SELECT id FROM hostels WHERE id = $1', [hostelId]);
    expect(unscoped.rowCount).toBe(0);
  });
});
