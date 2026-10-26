/**
 * Live Postgres proof for PgTimetableRepository (G-732): rooms, bell schedules
 * and periods round-trip through `withPgTenant`, soft deletes retire dependent
 * periods, and a second tenant cannot see any of it under FORCE RLS.
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { withPgTenant } from '@proctira/database';
import { ensurePgTestStaff } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import { getSharedTimetablePool, PgTimetableRepository } from './pg-timetable-repository.js';
const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-timetable-repository.live.test' });

const pool = getSharedTimetablePool();
const live = Boolean(DATABASE_URL) && pool !== null;

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

/**
 * `section_meetings.teacher_staff_id` carries a live FK to `staff(id)` (db/sql/003). Any test
 * that passes a staffId into createMeeting/createMeetingAtomic must create the row first, or
 * the insert fails closed with `..._teacher_staff_id_fkey` against real Postgres. Reuses the
 * shared ensurePgTestStaff fixture (also used by @proctira/backend-staff's live tests).
 */
async function seedStaff(tenantId: string): Promise<string> {
  const staffId = randomUUID();
  await ensurePgTestStaff(pool!, tenantId, staffId);
  return staffId;
}

/** Second academic_periods row for the same tenant, for tests that clone/insert into a distinct period. */
async function seedAcademicPeriod(tenantId: string): Promise<string> {
  const academicPeriodId = randomUUID();
  const suffix = academicPeriodId.slice(0, 8);
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date)
       VALUES ($1, $2, 'AY 2027-28', $3, '2027-04-01', '2028-03-31')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
  });
  return academicPeriodId;
}

describe('PgTimetableRepository (live)', () => {
  it.skipIf(!live)('persists rooms per institution and hides them from other tenants', async () => {
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

  it.skipIf(!live)('round-trips bell schedules + periods and cascades deletes', async () => {
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

  /**
   * PRC-M400: mapMeeting() hardcoded subjectId: null and MEETING_INSERT_SQL never wrote the
   * column, so a meeting created with a real subjectId silently lost it (round-tripped as null,
   * not an error) before the db/sql/230 column + repository wiring landed.
   */
  it.skipIf(!live)('round-trips a meeting subjectId through create and getMeeting', async () => {
    const repo = new PgTimetableRepository(pool!);
    const a = await seedFixture();
    const now = new Date().toISOString();
    const subjectId = randomUUID();
    await withPgTenant(pool!, a.tenantId, async (client) => {
      await client.query(
        `INSERT INTO subjects (id, tenant_id, code, name)
         VALUES ($1, $2, 'MATH', 'Mathematics')`,
        [subjectId, a.tenantId],
      );
    });
    const schedule = await repo.createBellSchedule({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      code: 'SUBJ',
      name: 'Subject day',
      dayPattern: '1,2,3,4,5',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const period = await repo.createPeriod({
      id: randomUUID(),
      tenantId: a.tenantId,
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
      createdAt: now,
      updatedAt: now,
    });
    const section = await repo.createSection({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      gradeId: null,
      code: '10-A',
      name: '10 A',
      primaryTeacherId: null,
      defaultRoomId: null,
      capacity: 30,
      status: 'DRAFT',
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const created = await repo.createMeeting({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      sectionId: section.id,
      subjectId,
      staffId: '',
      periodId: period.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    expect(created.subjectId).toBe(subjectId);
    const reread = await repo.getMeeting(a.tenantId, created.id);
    expect(reread?.subjectId).toBe(subjectId);
  });

  /**
   * PRC-M396(b): createMeetingAtomic serializes concurrent writers for the identical
   * (institution, day, period) slot behind a transaction-scoped advisory lock and re-runs the
   * clash check inside that same transaction. Before this fix, TimetableService's separate
   * pre-check + later insert left a race window where two concurrent createMeeting calls for
   * the identical slot could both pass the check and both insert (two active meetings for the
   * same teacher/slot). Fires two concurrent inserts for one slot; exactly one must succeed.
   */
  it.skipIf(!live)(
    'createMeetingAtomic lets exactly one of two concurrent same-slot inserts through',
    async () => {
      const repo = new PgTimetableRepository(pool!);
      const a = await seedFixture();
      const now = new Date().toISOString();
      const schedule = await repo.createBellSchedule({
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        code: 'RACE',
        name: 'Race day',
        dayPattern: '1,2,3,4,5',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      const period = await repo.createPeriod({
        id: randomUUID(),
        tenantId: a.tenantId,
        bellScheduleId: schedule.id,
        name: 'P1',
        periodOrder: 1,
        startTime: '08:00',
        endTime: '08:45',
        createdAt: now,
        updatedAt: now,
      });
      const sectionA = await repo.createSection({
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        gradeId: null,
        code: 'RACE-A',
        name: 'Race A',
        primaryTeacherId: null,
        defaultRoomId: null,
        capacity: 30,
        status: 'DRAFT',
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const sectionB = await repo.createSection({
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        gradeId: null,
        code: 'RACE-B',
        name: 'Race B',
        primaryTeacherId: null,
        defaultRoomId: null,
        capacity: 30,
        status: 'DRAFT',
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const staffId = await seedStaff(a.tenantId);
      const meetingFor = (sectionId: string): Parameters<typeof repo.createMeetingAtomic>[1] => ({
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        sectionId,
        subjectId: null,
        staffId,
        periodId: period.id,
        roomId: null,
        dayOfWeek: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      const clashCheck = (existing: { staffId: string }[]) => {
        if (existing.some((m) => m.staffId === staffId)) {
          throw new Error('staff already booked');
        }
      };
      const results = await Promise.allSettled([
        repo.createMeetingAtomic(a.tenantId, meetingFor(sectionA.id), clashCheck),
        repo.createMeetingAtomic(a.tenantId, meetingFor(sectionB.id), clashCheck),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    },
  );

  /**
   * PRC-L373 item 16: when TimetableServiceOptions.auditPool is wired, recordAudit must also
   * append a durable row to audit_log_entries (via @proctira/backend-audit), on top of the
   * existing in-memory push. Zero rows before the mutation, one after, with the real actorId.
   * Not failing-first required (not a security/tenancy finding per se) but documented as good
   * practice: assert the pre-state too.
   */
  it.skipIf(!live)(
    'createBellSchedule with auditPool wired durably records the real actorId',
    async () => {
      const repo = new PgTimetableRepository(pool!);
      const a = await seedFixture();
      const { TimetableService } = await import('./timetable-service.js');
      const service = new TimetableService(repo, undefined, { auditPool: pool! });
      const actorId = randomUUID();
      const before = await withPgTenant(pool!, a.tenantId, (client) =>
        client.query(
          `SELECT count(*)::int AS n FROM audit_log_entries WHERE tenant_id = $1 AND entity_type = 'bell_schedule'`,
          [a.tenantId],
        ),
      );
      expect(Number((before.rows[0] as { n: number }).n)).toBe(0);
      const schedule = await service.createBellSchedule(
        a.tenantId,
        {
          institutionId: a.institutionId,
          academicPeriodId: a.academicPeriodId,
          name: 'Audited day',
          code: 'AUD',
          dayPattern: '1,2,3,4,5',
          status: 'active',
        },
        actorId,
      );
      const after = await withPgTenant(pool!, a.tenantId, (client) =>
        client.query(
          `SELECT user_id FROM audit_log_entries
           WHERE tenant_id = $1 AND entity_type = 'bell_schedule' AND entity_id = $2`,
          [a.tenantId, schedule.id],
        ),
      );
      expect(after.rows).toHaveLength(1);
      expect((after.rows[0] as { user_id: string }).user_id).toBe(actorId);
    },
  );

  /**
   * PRC-L373 item 17: GET /timetable/audits reads the durable store, tenant-scoped — seeding
   * two mutations for tenant A and one for tenant B, a tenant-A caller must see exactly tenant
   * A's 2 rows and never tenant B's.
   */
  it.skipIf(!live)('GET /timetable/audits is tenant-scoped against the durable store', async () => {
    const repo = new PgTimetableRepository(pool!);
    const a = await seedFixture();
    const b = await seedFixture();
    const { TimetableService } = await import('./timetable-service.js');
    const { timetablePlugin } = await import('./timetable-plugin.js');
    const Fastify = (await import('fastify')).default;
    const service = new TimetableService(repo, undefined, { auditPool: pool! });
    await service.createBellSchedule(
      a.tenantId,
      {
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        name: 'A1',
        code: 'A1',
        dayPattern: '1,2,3,4,5',
        status: 'active',
      },
      'actor-a',
    );
    await service.createBellSchedule(
      a.tenantId,
      {
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        name: 'A2',
        code: 'A2',
        dayPattern: '1,2,3,4,5',
        status: 'active',
      },
      'actor-a',
    );
    await service.createBellSchedule(
      b.tenantId,
      {
        institutionId: b.institutionId,
        academicPeriodId: b.academicPeriodId,
        name: 'B1',
        code: 'B1',
        dayPattern: '1,2,3,4,5',
        status: 'active',
      },
      'actor-b',
    );
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId?: string }).tenantId = a.tenantId;
      (request as typeof request & { user: { id: string; roles: string[] } }).user = {
        id: 'actor-a',
        roles: ['admin'],
      };
    });
    await app.register(timetablePlugin, { repository: repo, service, prefix: '/timetable' });
    const res = await app.inject({ method: 'GET', url: '/timetable/audits' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ tenantId: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((row) => row.tenantId === a.tenantId)).toBe(true);
    await app.close();
  });

  /**
   * PRC-L503: createSubstitution/listSubstitutions cross-tenant isolation, matching the
   * existing room/bell-schedule cases' style (seed two tenants, assert invisibility).
   */
  it.skipIf(!live)('createSubstitution/listSubstitutions hide rows across tenants', async () => {
    const repo = new PgTimetableRepository(pool!);
    const a = await seedFixture();
    const b = await seedFixture();
    const now = new Date().toISOString();
    const schedule = await repo.createBellSchedule({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      code: 'SUB',
      name: 'Sub day',
      dayPattern: '1,2,3,4,5',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const period = await repo.createPeriod({
      id: randomUUID(),
      tenantId: a.tenantId,
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
      createdAt: now,
      updatedAt: now,
    });
    const section = await repo.createSection({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      gradeId: null,
      code: 'SUB-A',
      name: 'Sub A',
      primaryTeacherId: null,
      defaultRoomId: null,
      capacity: 30,
      status: 'DRAFT',
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const originalStaffId = await seedStaff(a.tenantId);
    const substituteStaffId = await seedStaff(a.tenantId);
    const meeting = await repo.createMeeting({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      sectionId: section.id,
      subjectId: null,
      staffId: originalStaffId,
      periodId: period.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const sub = await repo.createSubstitution({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      sectionMeetingId: meeting.id,
      originalStaffId,
      substituteStaffId,
      substitutionDate: '2026-09-07',
      reason: null,
      status: 'SCHEDULED',
      createdAt: now,
      updatedAt: now,
    });
    expect(sub.originalStaffId).toBe(originalStaffId);

    expect((await repo.getSubstitution(a.tenantId, sub.id))?.id).toBe(sub.id);
    expect(
      (await repo.listSubstitutions(a.tenantId, { institutionId: a.institutionId })).map(
        (s) => s.id,
      ),
    ).toEqual([sub.id]);

    // Cross-tenant: tenant B sees none of tenant A's substitutions.
    expect(await repo.getSubstitution(b.tenantId, sub.id)).toBeNull();
    expect(await repo.listSubstitutions(b.tenantId)).toEqual([]);
  });

  /**
   * PRC-L503: insertClonedTimetable atomicity against live PG — seed two tenants, clone into
   * one, assert the other tenant's data is never touched/visible (cross-tenant invisibility).
   */
  it.skipIf(!live)(
    'insertClonedTimetable writes are tenant-scoped and all-or-nothing',
    async () => {
      const repo = new PgTimetableRepository(pool!);
      const a = await seedFixture();
      const b = await seedFixture();
      const now = new Date().toISOString();
      const schedule = await repo.createBellSchedule({
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        code: 'CLN',
        name: 'Clone day',
        dayPattern: '1,2,3,4,5',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      const period = await repo.createPeriod({
        id: randomUUID(),
        tenantId: a.tenantId,
        bellScheduleId: schedule.id,
        name: 'P1',
        periodOrder: 1,
        startTime: '08:00',
        endTime: '08:45',
        createdAt: now,
        updatedAt: now,
      });
      const targetPeriodId = await seedAcademicPeriod(a.tenantId);
      const cloneStaffId = await seedStaff(a.tenantId);
      const clonedSection = {
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: targetPeriodId,
        gradeId: null,
        code: 'CLN-A',
        name: 'Clone A',
        primaryTeacherId: null,
        defaultRoomId: null,
        capacity: 30,
        status: 'DRAFT' as const,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const clonedMeeting = {
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: targetPeriodId,
        sectionId: clonedSection.id,
        subjectId: null,
        staffId: cloneStaffId,
        periodId: period.id,
        roomId: null,
        dayOfWeek: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await repo.insertClonedTimetable(a.tenantId, [clonedSection], [clonedMeeting]);
      expect(
        (await repo.listSections(a.tenantId, { academicPeriodId: targetPeriodId })).map(
          (s) => s.id,
        ),
      ).toEqual([clonedSection.id]);

      // Cross-tenant: tenant B cannot see any of tenant A's cloned rows.
      expect(await repo.listSections(b.tenantId, { academicPeriodId: targetPeriodId })).toEqual([]);
      expect(await repo.listMeetings(b.tenantId, { academicPeriodId: targetPeriodId })).toEqual([]);

      // Tenant mismatch guard: insertClonedTimetable rejects a row whose tenantId disagrees.
      await expect(
        repo.insertClonedTimetable(b.tenantId, [{ ...clonedSection, id: randomUUID() }], []),
      ).rejects.toThrow(/clone tenant mismatch/);
    },
  );

  /**
   * PRC-M550(b): createMeetingsAtomic is all-or-nothing. A batch whose second meeting clashes
   * (same teacher, same slot as the first) rolls back the first insert too; a clean batch
   * persists every meeting.
   */
  it.skipIf(!live)('createMeetingsAtomic rolls back the whole batch on a clash', async () => {
    const repo = new PgTimetableRepository(pool!);
    const a = await seedFixture();
    const now = new Date().toISOString();
    const schedule = await repo.createBellSchedule({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      code: 'BATCH',
      name: 'Batch day',
      dayPattern: '1,2,3,4,5',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const period = await repo.createPeriod({
      id: randomUUID(),
      tenantId: a.tenantId,
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
      createdAt: now,
      updatedAt: now,
    });
    const section = async (code: string) =>
      repo.createSection({
        id: randomUUID(),
        tenantId: a.tenantId,
        institutionId: a.institutionId,
        academicPeriodId: a.academicPeriodId,
        gradeId: null,
        code,
        name: code,
        primaryTeacherId: null,
        defaultRoomId: null,
        capacity: 30,
        status: 'DRAFT',
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    const [s1, s2, s3, s4] = await Promise.all([
      section('B-1'),
      section('B-2'),
      section('B-3'),
      section('B-4'),
    ]);
    const staffX = await seedStaff(a.tenantId);
    const staffY = await seedStaff(a.tenantId);
    const meeting = (sectionId: string, staffId: string, dayOfWeek: number) => ({
      id: randomUUID(),
      tenantId: a.tenantId,
      institutionId: a.institutionId,
      academicPeriodId: a.academicPeriodId,
      sectionId,
      subjectId: null,
      staffId,
      periodId: period.id,
      roomId: null,
      dayOfWeek,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const clashCheck = (existing: { staffId: string }[], candidate: { staffId: string }) => {
      if (existing.some((m) => m.staffId === candidate.staffId)) {
        throw new Error('staff already booked');
      }
    };

    const first = meeting(s1!.id, staffX, 1);
    await expect(
      repo.createMeetingsAtomic(a.tenantId, [first, meeting(s2!.id, staffX, 1)], clashCheck),
    ).rejects.toThrow(/staff already booked/);
    expect(await repo.getMeeting(a.tenantId, first.id)).toBeNull();
    expect(await repo.listMeetings(a.tenantId, { institutionId: a.institutionId })).toEqual([]);

    const clean = await repo.createMeetingsAtomic(
      a.tenantId,
      [meeting(s3!.id, staffX, 2), meeting(s4!.id, staffY, 2)],
      clashCheck,
    );
    expect(clean).toHaveLength(2);
    expect(
      (await repo.listMeetings(a.tenantId, { institutionId: a.institutionId })).map((m) => m.id),
    ).toEqual(expect.arrayContaining(clean.map((m) => m.id)));
  });
});
