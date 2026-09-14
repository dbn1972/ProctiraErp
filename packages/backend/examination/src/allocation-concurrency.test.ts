/**
 * W3-RACE-01 — concurrent seat / invigilator / room allocation must not double-book.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError } from '@proctira/common';
import { getSharedPgPool } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { invigilatorsAreClashFree } from './clash.js';
import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { InMemoryExamOpsStore, PgExamOpsStore } from './ops-store.js';
import { isPgExaminationEnabled } from './repository-factory.js';
import type { CreateExaminationInput } from './schemas.js';

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Concurrency Exam',
    code: `CX-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 200 }],
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

async function seedExamOps() {
  const tenantId = randomUUID();
  const repository = new InMemoryExaminationRepository();
  const store = new InMemoryExamOpsStore();
  const exams = new ExaminationService(repository);
  const ops = new ExamOpsService({ store, examinations: repository });
  const actor = { userId: randomUUID(), roles: ['Administrator'] };

  const studentId = randomUUID();
  repository.setStudentEnrollment({
    studentId,
    status: 'enrolled',
    institutionId: randomUUID(),
    completedSubjectCodes: ['MATH'],
  });
  const exam = await exams.create(tenantId, examBody());
  const subjectId = exam.subjects[0]!.id;
  const centerId = exam.centers[0]!.id;
  await exams.registerCandidate(tenantId, exam.id, {
    studentId,
    centerId,
    subjectIds: [subjectId],
  });

  return { tenantId, examId: exam.id, subjectId, centerId, ops, actor, store, repository };
}

describe('W3-RACE-01 allocation concurrency (in-memory)', () => {
  it('allows only one winner under concurrent overlapping room bookings', async () => {
    const { tenantId, examId, subjectId, centerId, ops, actor } = await seedExamOps();
    const date = futureDate(8);
    const payload = {
      subjectId,
      date,
      startTime: '09:00',
      endTime: '11:00',
      roomId: 'HALL-A',
      centerId,
    };

    const outcomes = await Promise.allSettled([
      ops.createSession(tenantId, examId, payload, actor),
      ops.createSession(tenantId, examId, payload, actor),
    ]);

    const ok = outcomes.filter(
      (o) => o.status === 'fulfilled' && (o.value as { ok: boolean }).ok,
    );
    const clash = outcomes.filter(
      (o) => o.status === 'fulfilled' && !(o.value as { ok: boolean }).ok,
    );
    expect(ok).toHaveLength(1);
    expect(clash).toHaveLength(1);

    const sessions = await ops.listSessions(tenantId, examId);
    expect(sessions.filter((s) => s.roomId === 'HALL-A' && s.date === date)).toHaveLength(1);
  });

  it('allows only one winner under concurrent invigilator overlap claims', async () => {
    const { tenantId, examId, subjectId, centerId, ops, actor } = await seedExamOps();
    const staffId = randomUUID();
    const date = futureDate(8);

    const a = await ops.createSession(
      tenantId,
      examId,
      {
        subjectId,
        date,
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId,
      },
      actor,
    );
    const b = await ops.createSession(
      tenantId,
      examId,
      {
        subjectId,
        date,
        startTime: '10:00',
        endTime: '12:00',
        roomId: 'HALL-B',
        centerId,
      },
      actor,
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const outcomes = await Promise.allSettled([
      ops.allocateInvigilator(tenantId, examId, a.session.id, { staffId }, actor),
      ops.allocateInvigilator(tenantId, examId, b.session.id, { staffId }, actor),
    ]);

    const ok = outcomes.filter((o) => o.status === 'fulfilled' && (o.value as { ok: boolean }).ok);
    const clash = outcomes.filter(
      (o) => o.status === 'fulfilled' && !(o.value as { ok: boolean }).ok,
    );
    expect(ok).toHaveLength(1);
    expect(clash).toHaveLength(1);

    const assignments = await ops.listInvigilators(tenantId, examId, a.session.id);
    const assignmentsB = await ops.listInvigilators(tenantId, examId, b.session.id);
    const all = [...assignments, ...assignmentsB];
    const slots = [a.session, b.session].map((s) => ({
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      roomId: s.roomId,
    }));
    expect(
      invigilatorsAreClashFree(
        slots,
        all.map((row) => ({ sessionId: row.sessionId, staffId: row.staffId })),
      ),
    ).toBe(true);
  });

  it('rejects duplicate staff on the same session under concurrency', async () => {
    const { tenantId, examId, subjectId, centerId, ops, actor } = await seedExamOps();
    const staffId = randomUUID();
    const session = await ops.createSession(
      tenantId,
      examId,
      {
        subjectId,
        date: futureDate(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId,
      },
      actor,
    );
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    const outcomes = await Promise.allSettled([
      ops.allocateInvigilator(tenantId, examId, session.session.id, { staffId }, actor),
      ops.allocateInvigilator(tenantId, examId, session.session.id, { staffId }, actor),
    ]);

    const ok = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const listed = await ops.listInvigilators(tenantId, examId, session.session.id);
    expect(listed.filter((row) => row.staffId === staffId)).toHaveLength(1);
  });

  it('serializes concurrent seating generation for one examination', async () => {
    const { tenantId, examId, ops, actor } = await seedExamOps();

    const outcomes = await Promise.allSettled([
      ops.generateSeating(tenantId, examId, { seatsPerRoom: 30 }, actor),
      ops.generateSeating(tenantId, examId, { seatsPerRoom: 30 }, actor),
    ]);

    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    const listed = await ops.listSeating(tenantId, examId);
    expect(listed).toHaveLength(1);
    const candidateIds = new Set(listed.map((row) => row.candidateId));
    expect(candidateIds.size).toBe(listed.length);
  });
});

describe('W3-RACE-01 allocation concurrency (live Postgres)', () => {
  it.skipIf(!isPgExaminationEnabled())(
    'serializes concurrent room bookings with advisory lock',
    async () => {
    const pool = getSharedPgPool();
    expect(pool).not.toBeNull();
    const tenantId = randomUUID();
    const repository = new InMemoryExaminationRepository();
    const store = new PgExamOpsStore(pool!);
    const exams = new ExaminationService(repository);
    const ops = new ExamOpsService({ store, examinations: repository });
    const actor = { userId: randomUUID(), roles: ['Administrator'] };

    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH'],
    });
    const exam = await exams.create(tenantId, examBody());
    const subjectId = exam.subjects[0]!.id;
    const centerId = exam.centers[0]!.id;
    const date = futureDate(8);
    const payload = {
      subjectId,
      date,
      startTime: '09:00',
      endTime: '11:00',
      roomId: `HALL-${randomUUID().slice(0, 6)}`,
      centerId,
    };

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => ops.createSession(tenantId, exam.id, payload, actor)),
    );

    const ok = outcomes.filter(
      (o) => o.status === 'fulfilled' && (o.value as { ok: boolean }).ok,
    );
    const clash = outcomes.filter(
      (o) => o.status === 'fulfilled' && !(o.value as { ok: boolean }).ok,
    );
    expect(ok).toHaveLength(1);
    expect(clash).toHaveLength(4);
    },
  );
});
