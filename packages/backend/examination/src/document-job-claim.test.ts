/**
 * PRC-M235 — document jobs are claimed with compare-and-set, transient failures
 * stay retriable, and raw error text never reaches the job record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentGenerationService,
  GENERIC_DOCUMENT_FAILURE,
} from './document-generation-service.js';
import type { DocumentCandidate } from './document-repository.js';
import type { ExaminationEntity } from './examination-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { SimplePdfGenerator, type PdfGenerator } from './pdf-generator.js';

const TENANT = 'tenant-m235';

function scheduledExam(tenantId = TENANT): ExaminationEntity {
  const start = new Date();
  start.setDate(start.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  return {
    id: 'exam-m235',
    tenantId,
    name: 'Finals',
    code: 'FIN',
    description: null,
    academicPeriodId: 'period-1',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    status: 'SCHEDULED',
    subjects: [{ id: 'sub-1', examinationId: 'exam-m235', name: 'Math', code: 'M', maxScore: 100 }],
    centers: [
      {
        id: 'c-1',
        examinationId: 'exam-m235',
        name: 'Center',
        code: 'C',
        institutionId: 'i-1',
        capacity: 5000,
      },
    ],
    sessions: [],
    gradingSchemes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ExaminationEntity;
}

function candidates(n: number): DocumentCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cand-${String(i).padStart(5, '0')}`,
    studentId: `stu-${i}`,
    studentName: `Student ${i}`,
    rollNumber: `R${i}`,
    centerId: 'c-1',
    centerName: 'Center',
    subjectIds: ['sub-1'],
    subjectNames: ['Math'],
    gender: 'other',
  }));
}

describe('document job processing (PRC-M235)', () => {
  let exams: InMemoryExaminationRepository;
  let docs: InMemoryDocumentRepository;

  beforeEach(async () => {
    exams = new InMemoryExaminationRepository();
    docs = new InMemoryDocumentRepository();
    await exams.create(scheduledExam());
    docs.seedCandidates('exam-m235', candidates(3));
  });

  it('processing the same job twice concurrently runs it once', async () => {
    const pdf = new SimplePdfGenerator();
    const spy = vi.spyOn(pdf, 'generateAdmitCards');
    const service = new DocumentGenerationService(exams, docs, pdf);
    const job = await service.requestGeneration(TENANT, 'exam-m235', {
      documentType: 'admit_card',
    });
    const [a, b] = await Promise.all([
      service.processJob(TENANT, job.id),
      service.processJob(TENANT, job.id),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([a.status, b.status]).toContain('completed');
    // A repeated /process on a completed job is a no-op.
    await service.processJob(TENANT, job.id);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a transient failure keeps the job retriable and stores no raw error text', async () => {
    const failing: PdfGenerator = {
      ...new SimplePdfGenerator(),
      generateAdmitCards: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'relation "exam_docs" does not exist\n    at Parser.parse (pg/lib/parser.js:1:1)',
          ),
        )
        .mockResolvedValue(Buffer.from('%PDF-1.4 ok')),
    } as unknown as PdfGenerator;
    const service = new DocumentGenerationService(exams, docs, failing);
    const job = await service.requestGeneration(TENANT, 'exam-m235', {
      documentType: 'admit_card',
    });

    const first = await service.processJob(TENANT, job.id);
    expect(first.status).toBe('queued');
    expect(first.errorMessage).toBe(GENERIC_DOCUMENT_FAILURE);
    expect(first.errorMessage).not.toMatch(/relation|Parser|at /);

    // Worker mode rethrows so the broker redelivers.
    const workerFail = new DocumentGenerationService(exams, docs, {
      ...new SimplePdfGenerator(),
      generateAdmitCards: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    } as unknown as PdfGenerator);
    await expect(workerFail.processJob(TENANT, job.id, { rethrowRetryable: true })).rejects.toThrow(
      'ECONNRESET',
    );
    expect((await docs.getJob(job.id, TENANT))!.status).toBe('queued');

    const retried = await service.processJob(TENANT, job.id);
    expect(retried.status).toBe('completed');
  });

  it('another tenant cannot process or read the job (404)', async () => {
    const service = new DocumentGenerationService(exams, docs, new SimplePdfGenerator());
    const job = await service.requestGeneration(TENANT, 'exam-m235', {
      documentType: 'admit_card',
    });
    await expect(service.processJob('other-tenant', job.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await docs.getJob(job.id, TENANT))!.status).toBe('queued');
  });
});
