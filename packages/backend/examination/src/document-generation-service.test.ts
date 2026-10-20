/**
 * Document Generation Service Tests
 *
 * Tests for examination document generation including admit cards,
 * seating plans, and result certificates.
 *
 * Requirements:
 * - 10.6: Generate examination documents as PDF files within 60 seconds
 *         per batch of up to 500 candidates
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';

import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExamOpsStore } from './ops-store.js';
import type { ExamSessionRecord } from './ops-store.js';
import { SimplePdfGenerator } from './pdf-generator.js';
import type { ExaminationInfo } from './pdf-generator.js';
import {
  DocumentGenerationService,
  MAX_BATCH_SIZE,
  NoOpDocumentTaskQueue,
} from './document-generation-service.js';
import type {
  DocumentCandidate,
  SeatingAssignment,
  CandidateResultData,
} from './document-repository.js';
import type { ExaminationEntity } from './examination-repository.js';

describe('DocumentGenerationService', () => {
  let examinationRepository: InMemoryExaminationRepository;
  let documentRepository: InMemoryDocumentRepository;
  let pdfGenerator: SimplePdfGenerator;
  let taskQueue: NoOpDocumentTaskQueue;
  let service: DocumentGenerationService;

  const tenantId = 'tenant-001';

  // Helper to create a scheduled examination
  function createScheduledExamination(overrides?: Partial<ExaminationEntity>): ExaminationEntity {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const endDate = new Date(futureDate);
    endDate.setDate(endDate.getDate() + 5);

    return {
      id: 'exam-001',
      tenantId,
      name: 'Final Examination 2024',
      code: 'FINAL-2024',
      description: 'Annual final examination',
      academicPeriodId: 'period-001',
      startDate: futureDate.toISOString().split('T')[0]!,
      endDate: endDate.toISOString().split('T')[0]!,
      status: 'SCHEDULED',
      subjects: [
        {
          id: 'sub-001',
          examinationId: 'exam-001',
          name: 'Mathematics',
          code: 'MATH',
          maxScore: 100,
        },
        { id: 'sub-002', examinationId: 'exam-001', name: 'Science', code: 'SCI', maxScore: 100 },
      ],
      centers: [
        {
          id: 'center-001',
          examinationId: 'exam-001',
          name: 'Center A',
          code: 'CA',
          institutionId: 'inst-001',
          capacity: 200,
        },
        {
          id: 'center-002',
          examinationId: 'exam-001',
          name: 'Center B',
          code: 'CB',
          institutionId: 'inst-002',
          capacity: 150,
        },
      ],
      sessions: [
        {
          id: 'sess-001',
          examinationId: 'exam-001',
          subjectId: 'sub-001',
          date: futureDate.toISOString().split('T')[0]!,
          startTime: '09:00',
          endTime: '12:00',
        },
        {
          id: 'sess-002',
          examinationId: 'exam-001',
          subjectId: 'sub-002',
          date: endDate.toISOString().split('T')[0]!,
          startTime: '09:00',
          endTime: '12:00',
        },
      ],
      gradingSchemes: [
        {
          id: 'gs-001',
          examinationId: 'exam-001',
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
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function createCandidates(count: number): DocumentCandidate[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `cand-${String(i + 1).padStart(3, '0')}`,
      studentId: `student-${String(i + 1).padStart(3, '0')}`,
      studentName: `Student ${i + 1}`,
      rollNumber: `ROLL-${String(i + 1).padStart(4, '0')}`,
      centerId: i % 2 === 0 ? 'center-001' : 'center-002',
      centerName: i % 2 === 0 ? 'Center A' : 'Center B',
      subjectIds: ['sub-001', 'sub-002'],
      subjectNames: ['Mathematics', 'Science'],
      gender: i % 2 === 0 ? 'male' : 'female',
    }));
  }

  function createSeatingAssignments(count: number): SeatingAssignment[] {
    return Array.from({ length: count }, (_, i) => ({
      candidateId: `cand-${String(i + 1).padStart(3, '0')}`,
      studentName: `Student ${i + 1}`,
      rollNumber: `ROLL-${String(i + 1).padStart(4, '0')}`,
      centerId: i % 2 === 0 ? 'center-001' : 'center-002',
      centerName: i % 2 === 0 ? 'Center A' : 'Center B',
      roomNumber: `Room ${Math.floor(i / 30) + 1}`,
      seatNumber: `S${String((i % 30) + 1).padStart(2, '0')}`,
      subjectNames: ['Mathematics', 'Science'],
    }));
  }

  function createCandidateResults(count: number): CandidateResultData[] {
    return Array.from({ length: count }, (_, i) => ({
      candidateId: `cand-${String(i + 1).padStart(3, '0')}`,
      studentId: `student-${String(i + 1).padStart(3, '0')}`,
      studentName: `Student ${i + 1}`,
      rollNumber: `ROLL-${String(i + 1).padStart(4, '0')}`,
      subjects: [
        { name: 'Mathematics', score: 60 + (i % 40), grade: 'B', passed: true },
        { name: 'Science', score: 50 + (i % 50), grade: 'C', passed: true },
      ],
      overallGrade: 'B',
      overallPassed: true,
      totalScore: 110 + (i % 90),
      maxPossibleScore: 200,
    }));
  }

  beforeEach(() => {
    examinationRepository = new InMemoryExaminationRepository();
    documentRepository = new InMemoryDocumentRepository();
    pdfGenerator = new SimplePdfGenerator();
    taskQueue = new NoOpDocumentTaskQueue();
    service = new DocumentGenerationService(
      examinationRepository,
      documentRepository,
      pdfGenerator,
      taskQueue,
    );
  });

  describe('requestGeneration', () => {
    it('should create a queued job for admit card generation', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(10);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      expect(job.status).toBe('queued');
      expect(job.documentType).toBe('admit_card');
      expect(job.examinationId).toBe('exam-001');
      expect(job.totalCandidates).toBe(10);
      expect(job.tenantId).toBe(tenantId);
    });

    it('should create a queued job for seating plan generation', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'seating_plan',
      });

      expect(job.status).toBe('queued');
      expect(job.documentType).toBe('seating_plan');
    });

    it('should create a queued job for result certificate generation', async () => {
      const exam = createScheduledExamination({ status: 'COMPLETED' });
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'result_certificate',
      });

      expect(job.status).toBe('queued');
      expect(job.documentType).toBe('result_certificate');
    });

    it('should throw NotFoundError for non-existent examination', async () => {
      await expect(
        service.requestGeneration(tenantId, 'non-existent', {
          documentType: 'admit_card',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ValidationError when generating admit cards for DRAFT examination', async () => {
      const exam = createScheduledExamination({ status: 'DRAFT' });
      await examinationRepository.create(exam);

      await expect(
        service.requestGeneration(tenantId, 'exam-001', {
          documentType: 'admit_card',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when generating result certificates for non-COMPLETED examination', async () => {
      const exam = createScheduledExamination({ status: 'SCHEDULED' });
      await examinationRepository.create(exam);

      await expect(
        service.requestGeneration(tenantId, 'exam-001', {
          documentType: 'result_certificate',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when batch size exceeds 500', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);

      const candidateIds = Array.from({ length: 501 }, (_, i) => `cand-${i}`);

      await expect(
        service.requestGeneration(tenantId, 'exam-001', {
          documentType: 'admit_card',
          candidateIds,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should limit resolved candidates to MAX_BATCH_SIZE when no candidateIds provided', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      // Seed more than 500 candidates
      const candidates = createCandidates(600);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      expect(job.totalCandidates).toBe(MAX_BATCH_SIZE);
    });

    it('should accept specific candidate IDs within batch limit', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(10);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
        candidateIds: ['cand-001', 'cand-002', 'cand-003'],
      });

      expect(job.totalCandidates).toBe(3);
      expect(job.candidateIds).toEqual(['cand-001', 'cand-002', 'cand-003']);
    });
  });

  describe('processJob', () => {
    it('should process admit card generation job successfully', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);

      // Create a queued job
      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      // Process the job
      const result = await service.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(result.processedCount).toBe(5);
      expect(result.failedCount).toBe(0);
      expect(result.outputPath).toContain('admit_card');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.completedAt).toBeDefined();
    });

    it('should process seating plan generation job successfully', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(10);
      documentRepository.seedCandidates('exam-001', candidates);
      const assignments = createSeatingAssignments(10);
      documentRepository.seedSeatingAssignments('exam-001', assignments);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'seating_plan',
      });

      const result = await service.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(result.outputPath).toContain('seating_plan');
    });

    it('should process result certificate generation job successfully', async () => {
      const exam = createScheduledExamination({ status: 'COMPLETED' });
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);
      const results = createCandidateResults(5);
      documentRepository.seedCandidateResults('exam-001', results);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'result_certificate',
      });

      const result = await service.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(result.outputPath).toContain('result_certificate');
    });

    it('should throw NotFoundError for non-existent job', async () => {
      await expect(service.processJob(tenantId, 'non-existent-job')).rejects.toThrow(NotFoundError);
    });

    it('should handle processing failure gracefully', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(3);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      // Delete the examination to cause a failure during processing
      await examinationRepository.delete('exam-001', tenantId);

      const result = await service.processJob(tenantId, job.id);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBeDefined();
    });

    it('should process a batch of 500 candidates', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(500);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      const result = await service.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(result.processedCount).toBe(500);
    });
  });

  describe('getJobStatus', () => {
    it('should return job status', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      const status = await service.getJobStatus(tenantId, job.id);

      expect(status.id).toBe(job.id);
      expect(status.status).toBe('queued');
    });

    it('should throw NotFoundError for non-existent job', async () => {
      await expect(service.getJobStatus(tenantId, 'non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listJobs', () => {
    it('should list all jobs for an examination', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);

      await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });
      await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'seating_plan',
      });

      const jobs = await service.listJobs(tenantId, 'exam-001');

      expect(jobs).toHaveLength(2);
    });

    it('should throw NotFoundError for non-existent examination', async () => {
      await expect(service.listJobs(tenantId, 'non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('RabbitMQ task queue integration', () => {
    it('should publish job to task queue on request', async () => {
      let publishedJob: any = null;
      const mockTaskQueue = {
        async publishDocumentTask(job: any) {
          publishedJob = job;
        },
      };

      const serviceWithQueue = new DocumentGenerationService(
        examinationRepository,
        documentRepository,
        pdfGenerator,
        mockTaskQueue,
      );

      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(5);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await serviceWithQueue.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      expect(publishedJob).not.toBeNull();
      expect(publishedJob.id).toBe(job.id);
      expect(publishedJob.documentType).toBe('admit_card');
    });
  });

  describe('document type state validation', () => {
    it('should allow admit card generation for SCHEDULED examination', async () => {
      const exam = createScheduledExamination({ status: 'SCHEDULED' });
      await examinationRepository.create(exam);
      const candidates = createCandidates(3);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      expect(job.documentType).toBe('admit_card');
    });

    it('should allow admit card generation for IN_PROGRESS examination', async () => {
      const exam = createScheduledExamination({ status: 'IN_PROGRESS' });
      await examinationRepository.create(exam);
      const candidates = createCandidates(3);
      documentRepository.seedCandidates('exam-001', candidates);

      const job = await service.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });

      expect(job.documentType).toBe('admit_card');
    });

    it('should reject admit card generation for COMPLETED examination', async () => {
      const exam = createScheduledExamination({ status: 'COMPLETED' });
      await examinationRepository.create(exam);

      await expect(
        service.requestGeneration(tenantId, 'exam-001', {
          documentType: 'admit_card',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject result certificate generation for SCHEDULED examination', async () => {
      const exam = createScheduledExamination({ status: 'SCHEDULED' });
      await examinationRepository.create(exam);

      await expect(
        service.requestGeneration(tenantId, 'exam-001', {
          documentType: 'result_certificate',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject result certificate generation for IN_PROGRESS examination', async () => {
      const exam = createScheduledExamination({ status: 'IN_PROGRESS' });
      await examinationRepository.create(exam);

      await expect(
        service.requestGeneration(tenantId, 'exam-001', {
          documentType: 'result_certificate',
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('PRC-M510: admit cards before any marks exist', () => {
    it('resolves the registered student name instead of printing the raw studentId UUID', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      // No documentRepository.seedCandidates: resolveCandidates falls back to
      // candidate registrations (G-902 — admit cards straight after
      // registration, before any examination_candidates row exists).
      await examinationRepository.createCandidateRegistration({
        id: 'reg-001',
        tenantId,
        examinationId: 'exam-001',
        studentId: 'student-001',
        centerId: 'center-001',
        subjectIds: ['sub-001', 'sub-002'],
        status: 'REGISTERED',
        registeredAt: new Date(),
      });
      examinationRepository.setStudentName('student-001', 'Asha Verma');

      let seenCandidates: DocumentCandidate[] = [];
      const spyPdfGenerator = {
        ...pdfGenerator,
        async generateAdmitCards(examInfo: unknown, candidates: DocumentCandidate[]) {
          seenCandidates = candidates;
          return pdfGenerator.generateAdmitCards(examInfo as never, candidates);
        },
      };
      const spyService = new DocumentGenerationService(
        examinationRepository,
        documentRepository,
        spyPdfGenerator,
        taskQueue,
      );

      const job = await spyService.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });
      const result = await spyService.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(seenCandidates).toHaveLength(1);
      expect(seenCandidates[0]!.studentName).toBe('Asha Verma');
      expect(seenCandidates[0]!.studentName).not.toBe('student-001');
    });
  });

  describe('PRC-M232: admit cards prefer ops-table sessions over legacy JSONB sessions', () => {
    it('reflects the ops session when both an ops session and a legacy JSONB session exist', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(1);
      documentRepository.seedCandidates('exam-001', candidates);

      const opsStore = new InMemoryExamOpsStore();
      const opsSession: ExamSessionRecord = {
        id: 'ops-sess-001',
        tenantId,
        examinationId: 'exam-001',
        subjectId: 'sub-001',
        date: '2099-06-01',
        startTime: '14:00',
        endTime: '16:00',
        roomId: 'HALL-OPS',
        centerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await opsStore.createSession(opsSession);

      let seenExamInfo: ExaminationInfo | undefined;
      const spyPdfGenerator = {
        ...pdfGenerator,
        async generateAdmitCards(examInfo: ExaminationInfo, docCandidates: DocumentCandidate[]) {
          seenExamInfo = examInfo;
          return pdfGenerator.generateAdmitCards(examInfo, docCandidates);
        },
      };
      const serviceWithOps = new DocumentGenerationService(
        examinationRepository,
        documentRepository,
        spyPdfGenerator,
        taskQueue,
        undefined,
        undefined,
        { sessionSource: (t, e) => opsStore.listSessions(t, e) },
      );

      const job = await serviceWithOps.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });
      const result = await serviceWithOps.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(seenExamInfo).toBeDefined();
      expect(seenExamInfo!.sessions).toHaveLength(1);
      expect(seenExamInfo!.sessions[0]).toMatchObject({
        subjectName: 'Mathematics',
        date: '2099-06-01',
        startTime: '14:00',
        endTime: '16:00',
      });
      // The legacy JSONB session's times (09:00-12:00 / different dates from
      // createScheduledExamination) must not appear once the ops session wins.
      expect(seenExamInfo!.sessions.some((s) => s.startTime === '09:00')).toBe(false);
    });

    it('falls back to the legacy JSONB sessions unchanged when no ops sessions exist', async () => {
      const exam = createScheduledExamination();
      await examinationRepository.create(exam);
      const candidates = createCandidates(1);
      documentRepository.seedCandidates('exam-001', candidates);

      const opsStore = new InMemoryExamOpsStore();

      let seenExamInfo: ExaminationInfo | undefined;
      const spyPdfGenerator = {
        ...pdfGenerator,
        async generateAdmitCards(examInfo: ExaminationInfo, docCandidates: DocumentCandidate[]) {
          seenExamInfo = examInfo;
          return pdfGenerator.generateAdmitCards(examInfo, docCandidates);
        },
      };
      const serviceWithOps = new DocumentGenerationService(
        examinationRepository,
        documentRepository,
        spyPdfGenerator,
        taskQueue,
        undefined,
        undefined,
        { sessionSource: (t, e) => opsStore.listSessions(t, e) },
      );

      const job = await serviceWithOps.requestGeneration(tenantId, 'exam-001', {
        documentType: 'admit_card',
      });
      const result = await serviceWithOps.processJob(tenantId, job.id);

      expect(result.status).toBe('completed');
      expect(seenExamInfo).toBeDefined();
      expect(seenExamInfo!.sessions).toHaveLength(2);
      expect(seenExamInfo!.sessions.map((s) => s.startTime)).toEqual(['09:00', '09:00']);
    });
  });
});
