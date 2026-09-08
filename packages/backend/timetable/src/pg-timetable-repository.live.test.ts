/**
 * Live Postgres proof for PgTimetableRepository (G-732): rooms, bell schedules
 * and periods round-trip through `withPgTenant`, soft deletes retire dependent
 * periods, and a second tenant cannot see any of it under FORCE RLS.
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { getSharedTimetablePool, PgTimetableRepository } from './pg-timetable-repository.js';

const pool = getSharedTimetablePool();

interface Fixture {
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
}

/** tenant -> root area -> institution -> academic period (the FK chain rooms/bell schedules need). */
async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  const areaId = randomUUID();
  const institutionId = randomUUID();
  const academicPeriodId = randomUUID();
  const suffix = tenantId.slice(0, 8);
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `timetable-test-${suffix}`, `timetable-test-${tenantId}`],
    );
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantId],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership)
       VALUES ($1, $2, 'Timetable School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT')`,
      [institutionId, tenantId, `TT-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
  });
  return { tenantId, institutionId, academicPeriodId };
}

describe('PgTimetableRepository (live)', () => {
  it.skipIf(!pool)('persists rooms per institution and hides them from other tenants', async () => {
    const repo = new PgTimetableRepository(pool!);
    const a = await seedFixture();
    const b = await seedFixture();
    const now = new Date().toISOString();

    const room = await repo.createRoom({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      code: 'R-101',
      name: 'Room 101',
      capacity: 40,
      roomType: 'CLASSROOM',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    expect(room.capacity).toBe(40);

    expect((await repo.getRoom(a.tenantId, room.id))?.code).toBe('R-101');
    expect(
      (await repo.listRooms(a.tenantId, { institutionId: a.institutionId })).map((r) => r.id),
    ).toEqual([room.id]);

    expect(await repo.getRoom(b.tenantId, room.id)).toBeNull();
    expect(await repo.listRooms(b.tenantId)).toEqual([]);
  });

  it.skipIf(!pool)('round-trips bell schedules + periods and cascades deletes', async () => {
    const repo = new PgTimetableRepository(pool!);
    const a = await seedFixture();
    const b = await seedFixture();
    const now = new Date().toISOString();

    const schedule = await repo.createBellSchedule({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      code: 'STD',
      name: 'Standard day',
      dayPattern: '1,2,3,4,5',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    expect(schedule.dayPattern).toBe('1,2,3,4,5');

    const p1 = await repo.createPeriod({
      id: randomUUID(),
      tenantId: a.tenantId,
      bellScheduleId: schedule.id,
      name: 'Period 1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
      createdAt: now,
      updatedAt: now,
    });
    await repo.createPeriod({
      id: randomUUID(),
      tenantId: a.tenantId,
      bellScheduleId: schedule.id,
      name: 'Period 2',
      periodOrder: 2,
      startTime: '08:50',
      endTime: '09:35',
      createdAt: now,
      updatedAt: now,
    });

    const periods = await repo.listPeriods(a.tenantId, schedule.id);
    expect(periods.map((p) => p.periodOrder)).toEqual([1, 2]);
    expect(periods[0]?.startTime.startsWith('08:00')).toBe(true);

    const renamed = await repo.updateBellSchedule(a.tenantId, schedule.id, {
      name: 'Standard day v2',
    });
    expect(renamed?.name).toBe('Standard day v2');

    // Cross-tenant: schedule and its periods are invisible and un-updatable.
    expect(await repo.getBellSchedule(b.tenantId, schedule.id)).toBeNull();
    expect(await repo.listPeriods(b.tenantId, schedule.id)).toEqual([]);
    expect(await repo.updateBellSchedule(b.tenantId, schedule.id, { name: 'hijack' })).toBeNull();
    expect((await repo.getBellSchedule(a.tenantId, schedule.id))?.name).toBe('Standard day v2');

    // Period delete, then schedule delete retires the remaining periods too.
    await repo.deletePeriod(a.tenantId, p1.id);
    expect((await repo.listPeriods(a.tenantId, schedule.id)).map((p) => p.periodOrder)).toEqual([
      2,
    ]);
    await repo.deleteBellSchedule(a.tenantId, schedule.id);
    expect(await repo.getBellSchedule(a.tenantId, schedule.id)).toBeNull();
    expect(await repo.listPeriods(a.tenantId, schedule.id)).toEqual([]);
  });
});
