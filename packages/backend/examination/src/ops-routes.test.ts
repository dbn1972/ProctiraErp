/**
 * G-908 ops routes: clash 409, variance flag, resolve, re-evaluation, JWT actor.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { examinationPlugin } from './examination-plugin.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryExamOpsStore } from './ops-store.js';

const TENANT_ID = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody() {
  return {
    name: 'Ops Exam',
    code: `OP-${Date.now().toString(36).toUpperCase()}`,
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
          { grade: 'A', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
  };
}

describe('G-908 examination ops routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryExaminationRepository;
  let actorSub = USER_A;
  let actorRoles: Array<{ roleId: string; roleName: string; areaId: null }> = [
    { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
  ];

  beforeEach(async () => {
    actorSub = USER_A;
    actorRoles = [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }];
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { sub: string; roles: typeof actorRoles } }).user = {
        sub: actorSub,
        roles: actorRoles,
      };
    });
    repository = new InMemoryExaminationRepository();
    await app.register(examinationPlugin, {
      repository,
      examOpsStore: new InMemoryExamOpsStore(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedExam() {
    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH'],
    });
    const created = await app.inject({ method: 'POST', url: '/examinations', payload: examBody() });
    expect(created.statusCode).toBe(201);
    const exam = created.json();
    const registered = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/candidates`,
      payload: {
        studentId,
        centerId: exam.centers[0].id,
        subjectIds: [exam.subjects[0].id],
      },
    });
    expect(registered.statusCode).toBe(201);
    return {
      examId: exam.id as string,
      subjectId: exam.subjects[0].id as string,
      centerId: exam.centers[0].id as string,
      candidateId: registered.json().id as string,
    };
  }

  it('allocate → clash 409 → double entry variance → resolve → re-eval complete', async () => {
    const fx = await seedExam();
    const sessionA = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/sessions`,
      payload: {
        subjectId: fx.subjectId,
        date: futureDate(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId: fx.centerId,
      },
    });
    expect(sessionA.statusCode).toBe(201);
    const sessionB = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/sessions`,
      payload: {
        subjectId: fx.subjectId,
        date: futureDate(8),
        startTime: '10:00',
        endTime: '12:00',
        roomId: 'HALL-B',
        centerId: fx.centerId,
      },
    });
    expect(sessionB.statusCode).toBe(201);

    const staffId = randomUUID();
    const allocated = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/sessions/${sessionA.json().id}/invigilators`,
      payload: { staffId },
    });
    expect(allocated.statusCode).toBe(201);

    const clash = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/sessions/${sessionB.json().id}/invigilators`,
      payload: { staffId },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().conflicts[0].kind).toBe('staff_overlap');

    const roomClash = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/sessions`,
      payload: {
        subjectId: fx.subjectId,
        date: futureDate(8),
        startTime: '09:30',
        endTime: '10:30',
        roomId: 'HALL-A',
        centerId: fx.centerId,
      },
    });
    expect(roomClash.statusCode).toBe(409);

    const seating = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/seating/generate`,
      payload: {},
    });
    expect(seating.statusCode).toBe(200);
    expect(seating.json().data).toHaveLength(1);

    const first = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/marks/entries`,
      payload: { candidateId: fx.candidateId, subjectId: fx.subjectId, entryNo: 1, marks: 70 },
    });
    expect(first.statusCode).toBe(201);

    actorSub = USER_B;
    const second = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/marks/entries`,
      payload: {
        candidateId: fx.candidateId,
        subjectId: fx.subjectId,
        entryNo: 2,
        marks: 80,
        tolerance: 2,
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().varianceFlag).toBe(true);

    actorSub = USER_A;
    actorRoles = [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }];
    const denied = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/marks/resolve`,
      payload: { candidateId: fx.candidateId, subjectId: fx.subjectId, finalMarks: 75 },
    });
    expect(denied.statusCode).toBe(403);

    actorRoles = [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }];
    const resolved = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/marks/resolve`,
      payload: { candidateId: fx.candidateId, subjectId: fx.subjectId, finalMarks: 75 },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().finalMarks).toBe(75);

    const request = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/reevaluations`,
      payload: { candidateId: fx.candidateId, subjectId: fx.subjectId, originalMarks: 75 },
    });
    expect(request.statusCode).toBe(201);
    const requestId = request.json().id as string;
    const assigned = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/reevaluations/${requestId}/assign`,
      payload: { evaluatorId: randomUUID() },
    });
    expect(assigned.statusCode).toBe(200);
    const completed = await app.inject({
      method: 'POST',
      url: `/examinations/${fx.examId}/reevaluations/${requestId}/complete`,
      payload: { revisedMarks: 78, notes: 'Totalling error' },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe('completed');
    expect(completed.json().revisedMarks).toBe(78);
  });
});
