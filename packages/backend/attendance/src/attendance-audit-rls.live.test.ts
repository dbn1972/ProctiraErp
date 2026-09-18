/**
 * G-732 — attendance_audit RLS is derived from the parent attendance row.
 * Skips when DATABASE_URL is unset (Prisma migrations must be applied).
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { createPrismaClient, getSharedPgPool } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAttendanceRepository } from './prisma-attendance-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'attendance-audit-rls.live.test' });

describe.skipIf(!DATABASE_URL)('attendance_audit RLS (G-732)', () => {
  let prisma: PrismaClient;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const studentId = randomUUID();
  let attendanceId: string;

  beforeAll(async () => {
    prisma = createPrismaClient({ datasourceUrl: DATABASE_URL! });
    const fixturePool = getSharedPgPool(DATABASE_URL!);
    if (!fixturePool) throw new Error('DATABASE_URL is required for attendance fixtures');
    await Promise.all([
      ensurePgTestStudent(fixturePool, tenantA, studentId),
      ensurePgTestTenant(fixturePool, tenantB),
    ]);
    const repo = new PrismaAttendanceRepository(prisma);
    const record = await repo.createStudentAttendance({
      id: randomUUID(),
      tenantId: tenantA,
      studentId,
      institutionId: randomUUID(),
      classId: randomUUID(),
      academicPeriodId: randomUUID(),
      date: '2026-09-08',
      subjectId: null,
      periodId: null,
      status: 'PRESENT',
      comment: null,
      recordedBy: randomUUID(),
    } as never);
    attendanceId = record.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts audit writes bound to the parent tenant and hides them from other tenants', async () => {
    const repo = new PrismaAttendanceRepository(prisma);
    await repo.createAuditEntry({
      id: randomUUID(),
      tenantId: tenantA,
      attendanceId,
      previousStatus: 'PRESENT',
      newStatus: 'ABSENT',
      changedBy: randomUUID(),
      changedAt: new Date(),
    });

    expect(await repo.getAuditEntriesForAttendance(attendanceId, tenantA)).toHaveLength(1);
    expect(await repo.getAuditEntriesForAttendance(attendanceId, tenantB)).toHaveLength(0);
  });

  it('rejects audit writes when the bound tenant does not own the parent row', async () => {
    const repo = new PrismaAttendanceRepository(prisma);
    await expect(
      repo.createAuditEntry({
        id: randomUUID(),
        tenantId: tenantB,
        attendanceId,
        previousStatus: 'ABSENT',
        newStatus: 'LATE',
        changedBy: randomUUID(),
        changedAt: new Date(),
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
