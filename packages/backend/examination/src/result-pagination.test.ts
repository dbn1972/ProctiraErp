/**
 * PRC-M243 — GET .../results/marks and GET .../results previously returned
 * every candidate / gradeResult in one unbounded array. This asserts the
 * paginated envelope end to end: the route validates page/pageSize against
 * ListMarksQuerySchema and the service slices via ResultRepository's new
 * getCandidatesPage.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { ExaminationEntity } from './examination-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { registerResultRoutes } from './result-routes.js';
import { ResultPublicationService } from './result-publication-service.js';
import type { ExaminationCandidate } from './result-repository.js';

const TENANT = 'tenant-m243';
const EXAM_ID = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '11111111-1111-4111-8111-111111111111';

function makeExam(): ExaminationEntity {
  return {
    id: EXAM_ID,
    tenantId: TENANT,
    name: 'Pagination Exam',
    code: 'PAG',
    description: null,
    academicPeriodId: 'period-1',
    startDate: '2025-06-01',
    endDate: '2025-06-15',
    status: 'IN_PROGRESS',
    subjects: [
      {
        id: SUBJECT,
        examinationId: EXAM_ID,
        name: 'Mathematics',
        code: 'MATH',
        maxScore: 100,
      },
    ],
    centers: [],
    sessions: [],
    gradingSchemes: [
      {
        id: 'gs-1',
        examinationId: EXAM_ID,
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function candidate(index: number): ExaminationCandidate {
  const id = `cand-${String(index).padStart(3, '0')}`;
  return {
    id,
    examinationId: EXAM_ID,
    studentId: id,
    centerId: 'ctr-1',
    gender: 'other',
    areaId: '00000000-0000-0000-0000-000000000000',
    subjectResults: [{ candidateId: id, subjectId: SUBJECT, score: 50 + index, isComplete: true }],
  };
}

describe('GET .../results/marks pagination (PRC-M243)', () => {
  let app: FastifyInstance;
  let resultRepo: InMemoryResultRepository;

  beforeEach(async () => {
    const examRepo = new InMemoryExaminationRepository();
    await examRepo.create(makeExam());
    resultRepo = new InMemoryResultRepository();
    resultRepo.seedCandidates(EXAM_ID, [candidate(1), candidate(2), candidate(3)], TENANT);

    const service = new ResultPublicationService(examRepo, resultRepo);

    app = Fastify();
    app.addHook('onRequest', async (request) => {
      Object.assign(request, { tenantId: TENANT, user: { roles: ['registrar'] } });
    });
    await registerResultRoutes(app, { resultPublicationService: service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('page=1&pageSize=1 returns exactly 1 row with correct meta.totalItems', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/examinations/${EXAM_ID}/results/marks?page=1&pageSize=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].studentId).toBe('cand-001');
    expect(body.meta).toMatchObject({ page: 1, pageSize: 1, totalItems: 3, totalPages: 3 });
  });

  it('page=2&pageSize=1 returns the next row', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/examinations/${EXAM_ID}/results/marks?page=2&pageSize=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].studentId).toBe('cand-002');
    expect(body.meta).toMatchObject({ page: 2, pageSize: 1, totalItems: 3, totalPages: 3 });
  });

  it('defaults to page=1/pageSize=20 when no query params are given', async () => {
    const res = await app.inject({ method: 'GET', url: `/examinations/${EXAM_ID}/results/marks` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
  });

  it('rejects pageSize over 100', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/examinations/${EXAM_ID}/results/marks?pageSize=101`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET .../results gradeResults pagination (PRC-M243)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const examRepo = new InMemoryExaminationRepository();
    await examRepo.create(makeExam());
    const resultRepo = new InMemoryResultRepository();
    resultRepo.seedCandidates(EXAM_ID, [candidate(1), candidate(2), candidate(3)], TENANT);

    const service = new ResultPublicationService(examRepo, resultRepo);
    await service.publishResults(TENANT, EXAM_ID);

    app = Fastify();
    app.addHook('onRequest', async (request) => {
      Object.assign(request, { tenantId: TENANT, user: { roles: ['registrar'] } });
    });
    await registerResultRoutes(app, { resultPublicationService: service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('paginates gradeResults into a { data, meta } envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/examinations/${EXAM_ID}/results?page=1&pageSize=2`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gradeResults.data).toHaveLength(2);
    expect(body.gradeResults.meta).toMatchObject({ page: 1, pageSize: 2, totalItems: 3 });

    const page2 = await app.inject({
      method: 'GET',
      url: `/examinations/${EXAM_ID}/results?page=2&pageSize=2`,
    });
    expect(page2.json().gradeResults.data).toHaveLength(1);
  });
});
