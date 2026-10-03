/**
 * PRC-M238 — seating: session-scoped regenerate keeps other sessions' seats,
 * Postgres inserts are multi-row, and admit-card issuance blocks silent reseating.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { InMemoryExamOpsStore, PgExamOpsStore, type ExamSeatingRecord } from './ops-store.js';
import type { CreateExaminationInput } from './schemas.js';

const TENANT = randomUUID();
const ADMIN = { userId: randomUUID(), roles: ['Administrator'] };

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function body(): CreateExaminationInput {
  return {
    name: 'Board',
    code: `EX-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [
      { name: 'Mathematics', code: 'MATH', maxScore: 100 },
      { name: 'Science', code: 'SCI', maxScore: 100 },
    ],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 500 }],
    gradingSchemes: [
      {
        name: 'Std',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'P', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
  };
}

describe('seating generation (PRC-M238)', () => {
  let repository: InMemoryExaminationRepository;
  let documents: InMemoryDocumentRepository;
  let ops: ExamOpsService;
  let examId: string;
  let mathSession: string;
  let sciSession: string;

  beforeEach(async () => {
    repository = new InMemoryExaminationRepository();
    documents = new InMemoryDocumentRepository();
    const exams = new ExaminationService(repository);
    ops = new ExamOpsService({ store: new InMemoryExamOpsStore(), examinations: repository, documents });
    const exam = await exams.create(TENANT, body());
    examId = exam.id;
    const [math, sci] = exam.subjects;
    const centerId = exam.centers[0]!.id;
    for (const subject of [math!, sci!]) {
      const studentId = randomUUID();
      repository.setStudentEnrollment({
        studentId,
        status: 'enrolled',
        institutionId: randomUUID(),
        completedSubjectCodes: ['MATH', 'SCI'],
      });
      await exams.registerCandidate(TENANT, examId, {
        studentId,
        centerId,
        subjectIds: [subject.id],
      });
    }
    const mk = async (subjectId: string, room: string) => {
      const res = await ops.createSession(
        TENANT,
        examId,
        { subjectId, date: futureDate(8), startTime: '09:00', endTime: '11:00', roomId: room, centerId },
        ADMIN,
      );
      if (!res.ok) throw new Error('session clash');
      return res.session.id;
    };
    mathSession = await mk(math!.id, 'HALL-A');
    sciSession = await mk(sci!.id, 'HALL-B');
  });

  it("session-scoped generate keeps other sessions' seats", async () => {
    const math = await ops.generateSeating(TENANT, examId, { sessionId: mathSession }, ADMIN);
    const sci = await ops.generateSeating(TENANT, examId, { sessionId: sciSession }, ADMIN);
    expect(math).toHaveLength(1);
    expect(sci).toHaveLength(1);
    // Regenerating maths must not wipe science.
    await ops.generateSeating(TENANT, examId, { sessionId: mathSession }, ADMIN);
    const all = await ops.listSeating(TENANT, examId);
    expect(all.filter((s) => s.sessionId === sciSession)).toHaveLength(1);
    expect(all.filter((s) => s.sessionId === mathSession)).toHaveLength(1);
  });

  it('blocks regeneration after admit cards unless forced', async () => {
    await ops.generateSeating(TENANT, examId, {}, ADMIN);
    await documents.createJob({
      id: randomUUID(),
      tenantId: TENANT,
      examinationId: examId,
      documentType: 'admit_card',
      status: 'completed',
      candidateIds: [],
      totalCandidates: 0,
      processedCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    });
    await expect(ops.generateSeating(TENANT, examId, {}, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(ops.generateSeating(TENANT, examId, { force: true }, ADMIN)).resolves.toHaveLength(2);
  });
});

describe('PgExamOpsStore.replaceSeatingGuarded (PRC-M238)', () => {
  it('writes 5k seats with chunked multi-row INSERTs, scoped DELETE, in < 2s', async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[] = []) {
        statements.push({ sql, params });
        if (sql.trim().startsWith('INSERT INTO exam_seating')) {
          const rows: Record<string, unknown>[] = [];
          for (let i = 0; i < params.length; i += 14) {
            rows.push({
              id: params[i],
              tenant_id: params[i + 1],
              examination_id: params[i + 2],
              session_id: params[i + 3],
              candidate_id: params[i + 4],
              student_id: params[i + 5],
              student_name: params[i + 6],
              roll_number: params[i + 7],
              center_id: params[i + 8],
              center_name: params[i + 9],
              room_number: params[i + 10],
              seat_number: params[i + 11],
              subject_names: params[i + 12],
              generated_at: params[i + 13],
            });
          }
          return { rows };
        }
        return { rows: [] };
      },
      release() {},
    };
    const store = new PgExamOpsStore({ connect: async () => client } as never);
    const sessionId = randomUUID();
    const seats: ExamSeatingRecord[] = Array.from({ length: 5000 }, (_, i) => ({
      id: randomUUID(),
      tenantId: TENANT,
      examinationId: 'exam',
      sessionId,
      candidateId: `c-${i}`,
      studentId: `s-${i}`,
      studentName: `S ${i}`,
      rollNumber: `R${i}`,
      centerId: 'ctr',
      centerName: 'Center',
      roomNumber: `R${Math.floor(i / 40)}`,
      seatNumber: String(i % 40),
      subjectNames: ['Math'],
      generatedAt: new Date(),
    }));
    const started = Date.now();
    const saved = await store.replaceSeatingGuarded(TENANT, 'exam', seats, sessionId);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(saved).toHaveLength(5000);
    const inserts = statements.filter((s) => s.sql.trim().startsWith('INSERT INTO exam_seating'));
    expect(inserts).toHaveLength(5);
    const del = statements.find((s) => s.sql.includes('DELETE FROM exam_seating'))!;
    expect(del.sql).toContain('session_id = $3');
    expect(del.params).toEqual([TENANT, 'exam', sessionId]);
  });
});
