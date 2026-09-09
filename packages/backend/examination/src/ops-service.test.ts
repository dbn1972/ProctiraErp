/**
 * G-908 examination ops: allocation clashes, seating persist, double entry,
 * re-evaluation transitions.
 */
import { randomUUID } from 'node:crypto';

import { AppError, BusinessRuleError, ConflictError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService, isModeratorRole } from './ops-service.js';
import { InMemoryExamOpsStore } from './ops-store.js';
import { generateSeatingPlan } from './seating-generator.js';
import type { CreateExaminationInput } from './schemas.js';

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Board Exam',
    code: `EX-${Date.now().toString(36).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [
      { name: 'Mathematics', code: 'MATH', maxScore: 100 },
      { name: 'Science', code: 'SCI', maxScore: 100 },
    ],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 200 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 79 },
          { grade: 'C', minScore: 40, maxScore: 59 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
  };
}

const TENANT = randomUUID();
const STAFF_A = randomUUID();
const STAFF_B = randomUUID();
const ACTOR = { userId: randomUUID(), roles: ['Administrator'] };
const MARKER_2 = { userId: randomUUID(), roles: ['Teacher'] };
const TEACHER = { userId: randomUUID(), roles: ['Teacher'] };

describe('isModeratorRole', () => {
  it('accepts SUPER_ADMIN and moderator variants', () => {
    expect(isModeratorRole(['SUPER_ADMIN'])).toBe(true);
    expect(isModeratorRole(['moderator'])).toBe(true);
    expect(isModeratorRole(['Teacher'])).toBe(false);
  });
});

describe('ExamOpsService', () => {
  let repository: InMemoryExaminationRepository;
  let store: InMemoryExamOpsStore;
  let exams: ExaminationService;
  let ops: ExamOpsService;
  let examId: string;
  let subjectId: string;
  let centerId: string;
  let candidateId: string;

  beforeEach(async () => {
    repository = new InMemoryExaminationRepository();
    store = new InMemoryExamOpsStore();
    exams = new ExaminationService(repository);
    ops = new ExamOpsService({ store, examinations: repository });

    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH', 'SCI'],
    });
    const exam = await exams.create(TENANT, examBody());
    examId = exam.id;
    subjectId = exam.subjects[0]!.id;
    centerId = exam.centers[0]!.id;
    const registration = await exams.registerCandidate(TENANT, examId, {
      studentId,
      centerId,
      subjectIds: exam.subjects.map((s) => s.id),
    });
    candidateId = registration.id;
  });

  it('rejects a room double-booked for overlapping sessions', async () => {
    const first = await ops.createSession(
      TENANT,
      examId,
      {
        subjectId,
        date: futureDate(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId,
      },
      ACTOR,
    );
    expect(first.ok).toBe(true);
    const clash = await ops.createSession(
      TENANT,
      examId,
      {
        subjectId,
        date: futureDate(8),
        startTime: '10:00',
        endTime: '12:00',
        roomId: 'HALL-A',
        centerId,
      },
      ACTOR,
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) {
      expect(clash.conflicts[0]?.kind).toBe('room_overlap');
    }
  });

  it('allocates an invigilator and rejects a staff overlap', async () => {
    const a = await ops.createSession(
      TENANT,
      examId,
      {
        subjectId,
        date: futureDate(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId,
      },
      ACTOR,
    );
    const b = await ops.createSession(
      TENANT,
      examId,
      {
        subjectId,
        date: futureDate(8),
        startTime: '10:30',
        endTime: '12:30',
        roomId: 'HALL-B',
        centerId,
      },
      ACTOR,
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const ok = await ops.allocateInvigilator(
      TENANT,
      examId,
      a.session.id,
      { staffId: STAFF_A },
      ACTOR,
    );
    expect(ok.ok).toBe(true);
    const clash = await ops.allocateInvigilator(
      TENANT,
      examId,
      b.session.id,
      { staffId: STAFF_A },
      ACTOR,
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.conflicts[0]?.kind).toBe('staff_overlap');

    const other = await ops.allocateInvigilator(
      TENANT,
      examId,
      b.session.id,
      { staffId: STAFF_B },
      ACTOR,
    );
    expect(other.ok).toBe(true);
  });

  it('persists a generated seating plan matching the in-memory layout', async () => {
    const seats = await ops.generateSeating(TENANT, examId, {}, ACTOR);
    expect(seats).toHaveLength(1);
    expect(seats[0]?.seatNumber).toBe('S01');
    expect(seats[0]?.roomNumber).toBe('Room 1');
    const listed = await ops.listSeating(TENANT, examId);
    expect(listed).toHaveLength(1);
    const regenerated = generateSeatingPlan([
      {
        candidateId,
        studentId: listed[0]!.studentId ?? '',
        studentName: listed[0]!.studentName,
        rollNumber: listed[0]!.rollNumber,
        centerId: listed[0]!.centerId,
        centerName: listed[0]!.centerName,
        subjectNames: listed[0]!.subjectNames,
      },
    ]);
    expect(regenerated[0]?.seatNumber).toBe(listed[0]?.seatNumber);
  });

  it('flags variance on second entry by a different user and requires a moderator to resolve', async () => {
    const first = await ops.recordDoubleEntry(
      TENANT,
      examId,
      { candidateId, subjectId, entryNo: 1, marks: 80 },
      ACTOR,
    );
    expect(first.varianceFlag).toBe(false);

    await expect(
      ops.recordDoubleEntry(
        TENANT,
        examId,
        { candidateId, subjectId, entryNo: 2, marks: 90 },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const second = await ops.recordDoubleEntry(
      TENANT,
      examId,
      { candidateId, subjectId, entryNo: 2, marks: 90, tolerance: 2 },
      MARKER_2,
    );
    expect(second.varianceFlag).toBe(true);

    await expect(
      ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 85 }, TEACHER),
    ).rejects.toBeInstanceOf(AppError);

    const resolved = await ops.resolveMarks(
      TENANT,
      examId,
      { candidateId, subjectId, finalMarks: 85 },
      ACTOR,
    );
    expect(resolved.finalMarks).toBe(85);
    expect(resolved.resolved).toBe(true);
  });

  it('runs re-evaluation requested → assigned → completed with an audit delta', async () => {
    const requested = await ops.requestReevaluation(
      TENANT,
      examId,
      { candidateId, subjectId, originalMarks: 85, notes: 'Recheck paper' },
      ACTOR,
    );
    expect(requested.status).toBe('requested');
    const assigned = await ops.assignReevaluation(
      TENANT,
      examId,
      requested.id,
      { evaluatorId: STAFF_A },
      ACTOR,
    );
    expect(assigned.status).toBe('assigned');
    const completed = await ops.completeReevaluation(
      TENANT,
      examId,
      requested.id,
      { revisedMarks: 88, notes: 'Marking error' },
      ACTOR,
    );
    expect(completed.status).toBe('completed');
    expect(completed.revisedMarks).toBe(88);
    const audits = await ops.listAudits(TENANT, examId);
    const complete = audits.find((a) => a.action === 'reevaluation.complete');
    expect(complete?.details['delta']).toBe(3);
    expect(complete?.details['published']).toBe(true);
  });

  it('does not allocate the same staff twice on one session', async () => {
    const session = await ops.createSession(
      TENANT,
      examId,
      {
        subjectId,
        date: futureDate(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId,
      },
      ACTOR,
    );
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    await ops.allocateInvigilator(TENANT, examId, session.session.id, { staffId: STAFF_A }, ACTOR);
    await expect(
      ops.allocateInvigilator(TENANT, examId, session.session.id, { staffId: STAFF_A }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
