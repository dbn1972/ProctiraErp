/**
 * PRC-M231 — createSessionGuarded's existing-sessions recheck is scoped to
 * (tenant, room, date) instead of pulling every exam_sessions row the tenant
 * has ever created. This asserts the scoped query still finds the real clash
 * and is unaffected by seeding many unrelated-room/unrelated-date sessions in
 * the same tenant (noise rows that a tenant-only WHERE would have returned
 * too, just filtered out in app code afterwards).
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { PgExamOpsStore } from './ops-store.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'room-clash-scoping.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Room Clash Scoping Exam',
    code: `RCS-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 50 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 79 },
        ],
      },
    ],
  };
}

describe('PRC-M231: room clash check stays correct when scoped to (tenant, room, date)', () => {
  it.skipIf(!live)(
    'finds a real same-room/same-date clash and ignores unrelated-room/unrelated-date noise',
    async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      const repository = new InMemoryExaminationRepository();
      const store = new PgExamOpsStore(pool!);
      const exams = new ExaminationService(repository);
      const ops = new ExamOpsService({ store, examinations: repository });
      const actor = { userId: randomUUID(), roles: ['Administrator'] };

      const exam = await exams.create(tenantId, examBody());
      const subjectId = exam.subjects[0]!.id;
      const centerId = exam.centers[0]!.id;
      const date = futureDate(8);
      const room = `HALL-${randomUUID().slice(0, 6)}`;

      // Noise: many sessions in the same tenant, but neither this room nor
      // this date — a scoped (tenant, room, date) WHERE must not be misled by
      // these, and (before PRC-M231) an unscoped tenant-only fetch would have
      // pulled every one of these into the app-layer clash check too.
      for (let i = 0; i < 25; i++) {
        const outcome = await ops.createSession(
          tenantId,
          exam.id,
          {
            subjectId,
            date: futureDate(8 + i + 1),
            startTime: '09:00',
            endTime: '11:00',
            roomId: `OTHER-ROOM-${i}`,
            centerId,
          },
          actor,
        );
        expect(outcome.ok).toBe(true);
      }

      const first = await ops.createSession(
        tenantId,
        exam.id,
        { subjectId, date, startTime: '09:00', endTime: '11:00', roomId: room, centerId },
        actor,
      );
      expect(first.ok).toBe(true);

      // Real clash: same room, same date, overlapping time.
      const clash = await ops.createSession(
        tenantId,
        exam.id,
        { subjectId, date, startTime: '10:00', endTime: '12:00', roomId: room, centerId },
        actor,
      );
      expect(clash.ok).toBe(false);
      if (clash.ok) return;
      expect(clash.conflicts).toHaveLength(1);
      expect(clash.conflicts[0]!.kind).toBe('room_overlap');

      // Non-overlapping time in the same room/date still succeeds.
      const nonOverlapping = await ops.createSession(
        tenantId,
        exam.id,
        { subjectId, date, startTime: '13:00', endTime: '14:00', roomId: room, centerId },
        actor,
      );
      expect(nonOverlapping.ok).toBe(true);

      const sessions = await ops.listSessions(tenantId, exam.id);
      expect(sessions.filter((s) => s.roomId === room && s.date === date)).toHaveLength(2);
    },
  );
});
