/**
 * PRC-M236 — large document batches are split into ≤500-candidate jobs (no silent
 * truncation) and duration-budget breaches are reported.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DocumentGenerationService,
  MAX_BATCH_SIZE,
  MAX_GENERATION_DURATION_MS,
} from './document-generation-service.js';
import type { DocumentCandidate } from './document-repository.js';
import type { ExaminationEntity } from './examination-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { SimplePdfGenerator } from './pdf-generator.js';

const TENANT = 'tenant-m236';

function exam(): ExaminationEntity {
  const start = new Date();
  start.setDate(start.getDate() + 30);
  return {
    id: 'exam-m236',
    tenantId: TENANT,
    name: 'Finals',
    code: 'FIN',
    description: null,
    academicPeriodId: 'p',
    startDate: start.toISOString().slice(0, 10),
    endDate: start.toISOString().slice(0, 10),
    status: 'SCHEDULED',
    subjects: [{ id: 's', examinationId: 'exam-m236', name: 'Math', code: 'M', maxScore: 100 }],
    centers: [],
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
    studentName: `S${i}`,
    rollNumber: `R${i}`,
    centerId: 'c',
    centerName: 'C',
    subjectIds: ['s'],
    subjectNames: ['Math'],
    gender: 'other',
  }));
}

describe('document batch chunking (PRC-M236)', () => {
  it('1,200 registrations → 3 jobs that cover every candidate exactly once', async () => {
    const exams = new InMemoryExaminationRepository();
    const docs = new InMemoryDocumentRepository();
    await exams.create(exam());
    docs.seedCandidates('exam-m236', candidates(1200));
    const service = new DocumentGenerationService(exams, docs, new SimplePdfGenerator());

    const batch = await service.requestGenerationBatch(TENANT, 'exam-m236', {
      documentType: 'admit_card',
    });
    expect(batch.chunkCount).toBe(3);
    expect(batch.totalCandidates).toBe(1200);
    expect(batch.jobs.map((j) => j.totalCandidates)).toEqual([500, 500, 200]);
    expect(batch.jobs.every((j) => j.candidateIds.length <= MAX_BATCH_SIZE)).toBe(true);
    const covered = batch.jobs.flatMap((j) => j.candidateIds);
    expect(new Set(covered).size).toBe(1200);
    expect((await docs.listJobs('exam-m236', TENANT)).length).toBe(3);
  });

  it('logs when a job exceeds the generation duration budget', async () => {
    const exams = new InMemoryExaminationRepository();
    const docs = new InMemoryDocumentRepository();
    await exams.create(exam());
    docs.seedCandidates('exam-m236', candidates(2));
    const warn = vi.fn();
    const service = new DocumentGenerationService(
      exams,
      docs,
      new SimplePdfGenerator(),
      undefined,
      undefined,
      undefined,
      { logger: { warn } },
    );
    const job = await service.requestGeneration(TENANT, 'exam-m236', {
      documentType: 'admit_card',
    });
    const realNow = Date.now;
    let calls = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls += 1;
      return realNow() + (calls > 1 ? MAX_GENERATION_DURATION_MS + 1 : 0);
    });
    try {
      await service.processJob(TENANT, job.id);
    } finally {
      spy.mockRestore();
    }
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, budgetMs: MAX_GENERATION_DURATION_MS }),
      expect.stringContaining('duration budget'),
    );
  });
});
