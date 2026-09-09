/**
 * G-902 — the routes the examinations web tabs depend on, end to end through
 * the plugin: list candidates, record marks, publish, results, document jobs.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { examinationPlugin } from './examination-plugin.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { SimplePdfGenerator } from './pdf-generator.js';

const TENANT_ID = randomUUID();

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody() {
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

describe('G-902 examinations UI contract', () => {
  let app: FastifyInstance;
  let repository: InMemoryExaminationRepository;

  beforeEach(async () => {
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    });
    repository = new InMemoryExaminationRepository();
    await app.register(examinationPlugin, {
      repository,
      resultRepository: new InMemoryResultRepository(),
      documentRepository: new InMemoryDocumentRepository(),
      pdfGenerator: new SimplePdfGenerator(),
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('register → list candidates → marks → publish → results → documents', async () => {
    const created = await app.inject({ method: 'POST', url: '/examinations', payload: examBody() });
    expect(created.statusCode).toBe(201);
    const exam = created.json();
    const [math, sci] = exam.subjects as Array<{ id: string; code: string }>;
    const center = exam.centers[0] as { id: string };

    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH', 'SCI'],
    });

    const empty = await app.inject({ method: 'GET', url: `/examinations/${exam.id}/candidates` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data).toEqual([]);

    const registered = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/candidates`,
      payload: { studentId, centerId: center.id, subjectIds: [math!.id, sci!.id] },
    });
    expect(registered.statusCode).toBe(201);

    const listed = await app.inject({ method: 'GET', url: `/examinations/${exam.id}/candidates` });
    expect(listed.json().data).toHaveLength(1);
    expect(listed.json().data[0]).toMatchObject({ studentId, status: 'REGISTERED' });

    // Marks: centerId inferred from the registration; range validated.
    const badMarks = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/results/marks`,
      payload: { entries: [{ studentId, marks: [{ subjectId: math!.id, score: 150 }] }] },
    });
    expect(badMarks.statusCode).toBe(400);

    const unknownStudent = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/results/marks`,
      payload: {
        entries: [{ studentId: randomUUID(), marks: [{ subjectId: math!.id, score: 10 }] }],
      },
    });
    expect(unknownStudent.statusCode).toBe(400);

    const marks = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/results/marks`,
      payload: {
        entries: [
          {
            studentId,
            marks: [
              { subjectId: math!.id, score: 85 },
              { subjectId: sci!.id, score: 55 },
            ],
          },
        ],
      },
    });
    expect(marks.statusCode, marks.body).toBe(200);
    expect(marks.json()).toMatchObject({ candidateCount: 1, subjectResultCount: 2 });

    const recorded = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/results/marks`,
    });
    expect(recorded.json().data[0].subjectResults).toHaveLength(2);

    // Results before publication → 404 (page renders pending rows from marks).
    const notPublished = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/results`,
    });
    expect(notPublished.statusCode).toBe(404);

    // Documents (pre-publication): jobs list is what the web page reads;
    // generate admit cards → candidates resolved from registrations.
    const noJobs = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/documents/jobs`,
    });
    expect(noJobs.statusCode, noJobs.body).toBe(200);
    expect(noJobs.json().jobs).toEqual([]);

    const scheduled = await app.inject({
      method: 'PUT',
      url: `/examinations/${exam.id}`,
      payload: { status: 'SCHEDULED' },
    });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
    const admit = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/generate`,
      payload: { documentType: 'admit_card' },
    });
    expect(admit.statusCode, admit.body).toBe(202);
    expect(admit.json().totalCandidates).toBe(1);
    const admitDone = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/jobs/${admit.json().id}/process`,
    });
    expect(admitDone.statusCode, admitDone.body).toBe(200);
    expect(admitDone.json().status).toBe('completed');

    // Move to IN_PROGRESS then publish.
    const moved = await app.inject({
      method: 'PUT',
      url: `/examinations/${exam.id}`,
      payload: { status: 'IN_PROGRESS' },
    });
    expect(moved.statusCode).toBe(200);
    const published = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/results/publish`,
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().gradeResults).toHaveLength(2);
    expect(
      published
        .json()
        .gradeResults.map((g: { grade: string }) => g.grade)
        .sort(),
    ).toEqual(['A', 'C']);

    const locked = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/results/marks`,
      payload: { entries: [{ studentId, marks: [{ subjectId: math!.id, score: 10 }] }] },
    });
    expect(locked.statusCode).toBe(422);

    const jobs = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/documents/jobs`,
    });
    expect(jobs.statusCode, jobs.body).toBe(200);
    expect(jobs.json().jobs).toHaveLength(1);
    expect(jobs.json().jobs[0]).toMatchObject({ documentType: 'admit_card', status: 'completed' });

    const job = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/generate`,
      payload: { documentType: 'result_certificate' },
    });
    expect(job.statusCode, job.body).toBe(202);
    expect(job.json().totalCandidates).toBe(1);

    const processed = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/jobs/${job.json().id}/process`,
    });
    expect(processed.statusCode, processed.body).toBe(200);
    expect(processed.json().status).toBe('completed');

    // Download streams real PDF bytes for the completed job.
    const download = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/documents/jobs/${job.json().id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('registers a candidate when the enrollment source has no transcript data (null)', async () => {
    const created = await app.inject({ method: 'POST', url: '/examinations', payload: examBody() });
    const exam = created.json();
    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: null,
    });
    const registered = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/candidates`,
      payload: {
        studentId,
        centerId: exam.centers[0].id,
        subjectIds: exam.subjects.map((s: { id: string }) => s.id),
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);
  });
});
