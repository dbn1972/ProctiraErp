/**
 * PRC-M620 — cross-tenant negative authorization for the examination domain.
 *
 * Tenant B creates an examination, registers a candidate, records marks, and
 * generates a document job. Tenant A (a different tenantId, same staff
 * roles) must never be able to read any of tenant B's data through the
 * examination plugin's HTTP routes — every one of the routes below must
 * return 404 for tenant A, never 200 with tenant B's data, mirroring the
 * pattern in packages/backend/tenant/src/tenant-cross-tenant-authz.test.ts
 * (PRC-L591).
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { examinationPlugin } from './examination-plugin.js';
import { InMemoryDocumentBlobStore } from './document-generation-service.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryExamOpsStore } from './ops-store.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { SimplePdfGenerator } from './pdf-generator.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

// Staff role held by BOTH tenants' acting principal — proves the 404s below
// are tenant isolation, not a role/RBAC denial (examination-access.ts grants
// 'examinations_officer' every read/write action used here).
const STAFF_ROLES = ['examinations_officer'];

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody() {
  return {
    name: 'Cross-Tenant Exam',
    code: `CT-${Date.now().toString(36).toUpperCase()}`,
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

describe('cross-tenant examination isolation (PRC-M620)', () => {
  let app: FastifyInstance;
  let repository: InMemoryExaminationRepository;
  let activeTenant = TENANT_B;

  beforeEach(async () => {
    activeTenant = TENANT_B;
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = activeTenant;
      (request as unknown as { user: { roles: string[]; sub: string } }).user = {
        roles: STAFF_ROLES,
        sub: randomUUID(),
      };
    });
    repository = new InMemoryExaminationRepository();
    await app.register(examinationPlugin, {
      repository,
      resultRepository: new InMemoryResultRepository(),
      documentRepository: new InMemoryDocumentRepository(),
      pdfGenerator: new SimplePdfGenerator(),
      documentBlobStore: new InMemoryDocumentBlobStore(),
      examOpsStore: new InMemoryExamOpsStore(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('tenant A gets 404, never 200 with tenant B data, on every examination/results/documents/ops read', async () => {
    // --- Seed as tenant B: exam + candidate + marks + a completed document job + ops data. ---
    activeTenant = TENANT_B;
    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH'],
    });

    const examRes = await app.inject({ method: 'POST', url: '/examinations', payload: examBody() });
    expect(examRes.statusCode).toBe(201);
    const exam = examRes.json();
    const subjectId = exam.subjects[0].id as string;
    const centerId = exam.centers[0].id as string;

    const candidateRes = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/candidates`,
      payload: { studentId, centerId, subjectIds: [subjectId] },
    });
    expect(candidateRes.statusCode).toBe(201);

    // PRC-M233: status transitions are stepwise (DRAFT -> SCHEDULED -> IN_PROGRESS).
    await app.inject({
      method: 'PUT',
      url: `/examinations/${exam.id}`,
      payload: { status: 'SCHEDULED' },
    });
    await app.inject({
      method: 'PUT',
      url: `/examinations/${exam.id}`,
      payload: { status: 'IN_PROGRESS' },
    });

    await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/results/marks`,
      payload: {
        entries: [{ studentId, marks: [{ subjectId, score: 72 }] }],
      },
    });

    const sessionRes = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/sessions`,
      payload: {
        subjectId,
        date: futureDate(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: 'HALL-A',
        centerId,
      },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = sessionRes.json().id as string;

    const admitRes = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/generate`,
      payload: { documentType: 'admit_card' },
    });
    expect(admitRes.statusCode).toBe(202);
    const jobId = admitRes.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/jobs/${jobId}/process`,
    });

    const reevalRes = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/reevaluations`,
      payload: { candidateId: candidateRes.json().id, subjectId, originalMarks: 72 },
    });
    expect(reevalRes.statusCode).toBe(201);
    const reevaluationId = reevalRes.json().id as string;

    // --- Switch to tenant A (same staff roles) and attempt every read. ---
    activeTenant = TENANT_A;

    const tenantAReads = [
      `/examinations/${exam.id}`,
      `/examinations/${exam.id}/candidates`,
      `/examinations/${exam.id}/results`,
      `/examinations/${exam.id}/results/marks`,
      `/examinations/${exam.id}/documents/jobs`,
      `/examinations/${exam.id}/documents/jobs/${jobId}`,
      `/examinations/${exam.id}/documents/jobs/${jobId}/download`,
      `/examinations/${exam.id}/sessions`,
      `/examinations/${exam.id}/sessions/${sessionId}/invigilators`,
      `/examinations/${exam.id}/seating`,
      `/examinations/${exam.id}/marks/entries`,
      `/examinations/${exam.id}/reevaluations`,
    ];
    for (const url of tenantAReads) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `tenant A GET ${url}`).toBe(404);
    }

    // A listing (not a :id GET) of examinations under tenant A must not include
    // tenant B's examination either.
    const list = await app.inject({ method: 'GET', url: '/examinations' });
    expect(list.statusCode).toBe(200);
    expect((list.json().data as Array<{ id: string }>).map((e) => e.id)).not.toContain(exam.id);

    // Re-evaluation detail is reached via assign/complete/reject, not a GET — the
    // list route above already proves tenant A sees none of tenant B's requests,
    // but a direct action against B's requestId must also 404, not mutate B's data.
    const assignAttempt = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/reevaluations/${reevaluationId}/assign`,
      payload: { evaluatorId: randomUUID() },
    });
    expect(assignAttempt.statusCode).toBe(404);

    // --- Confirm tenant B's data is unchanged and still readable by tenant B. ---
    activeTenant = TENANT_B;
    const stillThere = await app.inject({ method: 'GET', url: `/examinations/${exam.id}` });
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().id).toBe(exam.id);
    const reevalStillRequested = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/reevaluations`,
    });
    expect(reevalStillRequested.statusCode).toBe(200);
    expect(reevalStillRequested.json().data[0].status).toBe('requested');
  });
});
