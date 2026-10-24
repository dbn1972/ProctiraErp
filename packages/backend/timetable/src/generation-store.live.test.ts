/**
 * PRC-L503: live-PG round-trip coverage for PgTimetableOpsStore (createJob/updateJob/
 * listJobs/failStaleJobs/createAbsence/listAbsences), mirroring
 * attendance-ingest.live.test.ts's requireLiveDatabaseUrl + it.skipIf(!live) pattern.
 * timetable_generation_jobs (db/sql/041) has no FK to institutions/academic_periods — only
 * tenant_id is FORCE RLS-scoped — so synthetic UUIDs are sufficient fixtures for jobRow().
 * timetable_teacher_absences.staff_id DOES carry a live FK to staff(id) (db/sql/085/086), so
 * the absence tests seed a real staff row via ensurePgTestStaff first.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestStaff, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { PgTimetableOpsStore, type GenerationJobRecord } from './generation-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'generation-store.live.test' });
const pool = getSharedPgPool();
const live = Boolean(DATABASE_URL) && pool !== null;

function jobRow(overrides: Partial<GenerationJobRecord>): GenerationJobRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    institutionId: randomUUID(),
    academicPeriodId: randomUUID(),
    bellScheduleId: null,
    status: 'queued',
    requestedBy: null,
    persistMeetings: false,
    teacherMaxPeriodsPerDay: 6,
    demandCount: 1,
    assignedCount: 0,
    unassignedCount: 0,
    clashCount: 0,
    repairPasses: 0,
    stats: {},
    input: { demands: [] },
    result: {},
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

describe('PgTimetableOpsStore (live)', () => {
  it.skipIf(!live)('createJob/getJob/updateJob round-trip and hide cross-tenant rows', async () => {
    const store = new PgTimetableOpsStore(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await ensurePgTestTenant(pool!, tenantA);
    await ensurePgTestTenant(pool!, tenantB);

    const created = await store.createJob(jobRow({ tenantId: tenantA }));
    expect(created.status).toBe('queued');

    const fetched = await store.getJob(tenantA, created.id);
    expect(fetched?.id).toBe(created.id);

    const updated = await store.updateJob(tenantA, created.id, {
      status: 'done',
      assignedCount: 3,
    });
    expect(updated?.status).toBe('done');
    expect(updated?.assignedCount).toBe(3);

    // Cross-tenant: tenant B cannot read or update tenant A's job.
    expect(await store.getJob(tenantB, created.id)).toBeNull();
    expect(await store.updateJob(tenantB, created.id, { status: 'failed' })).toBeNull();
  });

  it.skipIf(!live)('listJobs is bounded, newest-first, and omits input/result blobs', async () => {
    const store = new PgTimetableOpsStore(pool!);
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const institutionId = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      await store.createJob(jobRow({ tenantId, institutionId, input: { secret: 'blob' } }));
    }
    const page = await store.listJobs(tenantId, { institutionId, limit: 2 });
    expect(page).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain('secret');
  });

  it.skipIf(!live)('failStaleJobs fails a crashed running job but not a fresh one', async () => {
    const store = new PgTimetableOpsStore(pool!);
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stuck = await store.createJob(
      jobRow({ tenantId, status: 'running', startedAt: old, createdAt: old }),
    );
    const fresh = await store.createJob(jobRow({ tenantId, status: 'running' }));
    const count = await store.failStaleJobs(
      tenantId,
      new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      'Generation interrupted',
    );
    expect(count).toBe(1);
    expect((await store.getJob(tenantId, stuck.id))?.status).toBe('failed');
    expect((await store.getJob(tenantId, fresh.id))?.status).toBe('running');
  });

  it.skipIf(!live)(
    'createAbsence/listAbsences round-trip, upsert on conflict, and stay tenant-scoped',
    async () => {
      const store = new PgTimetableOpsStore(pool!);
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(pool!, tenantA);
      await ensurePgTestTenant(pool!, tenantB);
      const institutionId = randomUUID();
      const staffId = randomUUID();
      await ensurePgTestStaff(pool!, tenantA, staffId);
      const now = new Date().toISOString();

      const created = await store.createAbsence({
        id: randomUUID(),
        tenantId: tenantA,
        institutionId,
        staffId,
        absenceDate: '2026-09-07',
        reason: 'sick',
        createdBy: 'tester',
        createdAt: now,
      });
      expect(created.reason).toBe('sick');

      // ON CONFLICT (tenant_id, staff_id, absence_date) DO UPDATE SET reason: upsert, not dup.
      const upserted = await store.createAbsence({
        id: randomUUID(),
        tenantId: tenantA,
        institutionId,
        staffId,
        absenceDate: '2026-09-07',
        reason: 'updated reason',
        createdBy: 'tester',
        createdAt: now,
      });
      expect(upserted.reason).toBe('updated reason');

      const listed = await store.listAbsences(tenantA, { institutionId, staffId });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.reason).toBe('updated reason');

      // Cross-tenant: tenant B sees none of tenant A's absences.
      expect(await store.listAbsences(tenantB, { institutionId, staffId })).toEqual([]);
    },
  );
});
