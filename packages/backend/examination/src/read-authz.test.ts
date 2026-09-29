/**
 * PRC-C004 — examination read routes must reject non-staff (student/guardian) tokens and still
 * serve staff. This covers the named acceptance routes end-to-end through the plugin, including
 * the document jobs list, job status, and PDF download, plus the results reads.
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

describe('PRC-C004 examination read authorization', () => {
  let app: FastifyInstance;
  let repository: InMemoryExaminationRepository;
  let roles: string[] = ['examinations_officer'];

  beforeEach(async () => {
    roles = ['examinations_officer'];
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles };
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

  it('denies a student token on document jobs, PDF download, and results reads', async () => {
    // Seed as officer: exam + registered candidate + a completed document job.
    const exam = (
      await app.inject({ method: 'POST', url: '/examinations', payload: examBody() })
    ).json();
    const studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH'],
    });
    await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/candidates`,
      payload: { studentId, centerId: exam.centers[0].id, subjectIds: [exam.subjects[0].id] },
    });
    await app.inject({
      method: 'PUT',
      url: `/examinations/${exam.id}`,
      payload: { status: 'SCHEDULED' },
    });
    const admit = await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/generate`,
      payload: { documentType: 'admit_card' },
    });
    expect(admit.statusCode).toBe(202);
    const jobId = admit.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/examinations/${exam.id}/documents/jobs/${jobId}/process`,
    });

    // Now act as a student — every read route must return 403.
    roles = ['student'];
    const studentReads = [
      `/examinations/${exam.id}/documents/jobs`,
      `/examinations/${exam.id}/documents/jobs/${jobId}`,
      `/examinations/${exam.id}/documents/jobs/${jobId}/download`,
      `/examinations/${exam.id}/results`,
      `/examinations/${exam.id}/results/marks`,
      `/examinations/${exam.id}/candidates`,
      `/examinations/${exam.id}`,
    ];
    for (const url of studentReads) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `student GET ${url}`).toBe(403);
    }

    // Officer can still read the jobs list and download the PDF.
    roles = ['examinations_officer'];
    const jobs = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/documents/jobs`,
    });
    expect(jobs.statusCode).toBe(200);
    const download = await app.inject({
      method: 'GET',
      url: `/examinations/${exam.id}/documents/jobs/${jobId}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
  });
});
