/**
 * PRC-L278: live Postgres cross-tenant isolation for PgAttendanceOpsStore
 * (regularisation requests, leave requests, device keys), mirroring
 * pg-timetable-repository.live.test.ts's style. Skipped without
 * DATABASE_URL (no live Postgres reachable in this sandbox).
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { PgAttendanceOpsStore } from './ops-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-attendance-ops-store.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PgAttendanceOpsStore cross-tenant isolation (live)', () => {
  it.skipIf(!live)(
    'a regularisation request seeded for tenant A is invisible to tenant B',
    async () => {
      const store = new PgAttendanceOpsStore(pool!);
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantA, studentId);
      await ensurePgTestTenant(pool!, tenantB);

      const now = new Date().toISOString();
      const created = await store.createRegularisation({
        id: randomUUID(),
        tenantId: tenantA,
        attendanceId: randomUUID(),
        studentId,
        institutionId: randomUUID(),
        classId: randomUUID(),
        attendanceDate: '2026-06-10',
        fromStatus: 'ABSENT',
        toStatus: 'PRESENT',
        reason: null,
        requesterId: randomUUID(),
        requesterRole: 'parent',
        status: 'requested',
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        createdAt: now,
        updatedAt: now,
      });

      expect(await store.getRegularisation(tenantA, created.id)).not.toBeNull();
      expect(await store.getRegularisation(tenantB, created.id)).toBeNull();
      expect((await store.listRegularisations(tenantB)).map((r) => r.id)).not.toContain(created.id);
      expect((await store.listRegularisations(tenantA)).map((r) => r.id)).toContain(created.id);
    },
  );

  it.skipIf(!live)('a leave request seeded for tenant A is invisible to tenant B', async () => {
    const store = new PgAttendanceOpsStore(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestStudent(pool!, tenantA, studentId);
    await ensurePgTestTenant(pool!, tenantB);

    const now = new Date().toISOString();
    const created = await store.createLeave({
      id: randomUUID(),
      tenantId: tenantA,
      studentId,
      institutionId: randomUUID(),
      classId: randomUUID(),
      academicPeriodId: randomUUID(),
      fromDate: '2026-06-10',
      toDate: '2026-06-11',
      reason: null,
      attachmentUrl: null,
      requesterId: randomUUID(),
      requesterRole: 'parent',
      status: 'requested',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(await store.getLeave(tenantA, created.id)).not.toBeNull();
    expect(await store.getLeave(tenantB, created.id)).toBeNull();
    expect((await store.listLeaves(tenantB)).map((r) => r.id)).not.toContain(created.id);
    expect((await store.listLeaves(tenantA)).map((r) => r.id)).toContain(created.id);
  });

  it.skipIf(!live)(
    'a device key seeded for tenant A is invisible to tenant B (both by hash and by list)',
    async () => {
      const store = new PgAttendanceOpsStore(pool!);
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const institutionId = randomUUID();
      await ensurePgTestTenant(pool!, tenantA);
      await ensurePgTestTenant(pool!, tenantB);

      const apiKeyHash = randomUUID().replace(/-/g, '');
      const created = await store.createDeviceKey({
        id: randomUUID(),
        tenantId: tenantA,
        institutionId,
        deviceId: `gate-${randomUUID().slice(0, 8)}`,
        apiKeyHash,
        label: 'Live gate',
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      expect(await store.findDeviceKeyByHash(tenantA, apiKeyHash)).not.toBeNull();
      expect(await store.findDeviceKeyByHash(tenantB, apiKeyHash)).toBeNull();
      expect((await store.listDeviceKeys(tenantB)).map((d) => d.id)).not.toContain(created.id);
      expect((await store.listDeviceKeys(tenantA)).map((d) => d.id)).toContain(created.id);
    },
  );
});
