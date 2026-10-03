/**
 * Document Generation Service
 *
 * Business logic for examination document generation including admit cards,
 * seating plans, and result certificates. Supports batch processing of up to
 * 500 candidates within 60 seconds and queues generation via RabbitMQ.
 *
 * Requirements:
 * - 10.6: Generate examination documents (admit cards, seating plans, result certificates)
 *         as PDF files within 60 seconds per batch of up to 500 candidates
 */
import { NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';
import type { FieldError } from '@proctira/common';
import { buildExamDocumentOutboxEntry, type OutboxStore } from '@proctira/queue-abstraction';
import { v4 as uuidv4 } from 'uuid';

import type {
  DocumentCandidate,
  DocumentRepository,
  DocumentType,
  DocumentGenerationJob,
} from './document-repository.js';
import type { ExaminationRepository } from './examination-repository.js';
import type { PdfGenerator, ExaminationInfo } from './pdf-generator.js';

/** Maximum batch size for document generation */
export const MAX_BATCH_SIZE = 500;

/** Maximum allowed generation duration in milliseconds (60 seconds) */
export const MAX_GENERATION_DURATION_MS = 60_000;

/** PRC-M236: optional collaborators. */
export interface DocumentGenerationServiceOptions {
  /** Receives duration-budget breaches (MAX_GENERATION_DURATION_MS). */
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
}

/** PRC-M236: one requested generation split into ≤ MAX_BATCH_SIZE chunk jobs. */
export interface DocumentGenerationBatch {
  jobs: DocumentGenerationJob[];
  chunkCount: number;
  totalCandidates: number;
}

/** PRC-M235: options for one processing attempt. */
export interface ProcessDocumentJobOptions {
  /** Queue workers set this so transient failures propagate and the broker redelivers. */
  rethrowRetryable?: boolean;
}

/** PRC-M235: a `processing` claim older than this belongs to a crashed worker. */
export const STALE_PROCESSING_MS = 15 * 60 * 1000;

/** PRC-M235: user-facing text stored for unexpected (non-domain) failures. */
export const GENERIC_DOCUMENT_FAILURE =
  'Document generation failed due to a temporary error; it will be retried.';

/**
 * PRC-M235: domain errors (4xx AppErrors) are permanent and their curated
 * message is safe to show; anything else is transient and its raw text (stack,
 * SQL, driver detail) is never stored or returned.
 */
export function isPermanentDocumentError(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Input for requesting document generation.
 */
export interface GenerateDocumentsInput {
  documentType: DocumentType;
  /** Optional list of candidate IDs. If not provided, generates for all candidates. */
  candidateIds?: string[];
  /** Optional center ID for seating plan generation */
  centerId?: string;
}

/**
 * Interface for a task queue publisher (RabbitMQ).
 * Allows decoupling from the actual RabbitMQ implementation for testing.
 */
export interface DocumentTaskQueue {
  /** Publish a document generation task to the queue */
  publishDocumentTask(job: DocumentGenerationJob): Promise<void>;
}

/**
 * A no-op task queue for synchronous processing (used in testing or when queue is unavailable).
 */
export class NoOpDocumentTaskQueue implements DocumentTaskQueue {
  async publishDocumentTask(_job: DocumentGenerationJob): Promise<void> {
    // No-op: job will be processed synchronously
  }
}

/** Where generated PDFs are kept (G-902). */
export interface DocumentBlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

/** Default: process-local, bounded so long-running workers do not leak. */
export class InMemoryDocumentBlobStore implements DocumentBlobStore {
  private readonly blobs = new Map<string, Buffer>();

  constructor(private readonly maxEntries = 500) {}

  async put(key: string, bytes: Buffer): Promise<void> {
    if (this.blobs.size >= this.maxEntries) {
      const oldest = this.blobs.keys().next().value;
      if (oldest !== undefined) this.blobs.delete(oldest);
    }
    this.blobs.set(key, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.blobs.get(key) ?? null;
  }
}

/**
 * Service handling examination document generation.
 */
export class DocumentGenerationService {
  constructor(
    private readonly examinationRepository: ExaminationRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly pdfGenerator: PdfGenerator,
    private readonly taskQueue: DocumentTaskQueue = new NoOpDocumentTaskQueue(),
    private readonly blobStore: DocumentBlobStore = new InMemoryDocumentBlobStore(),
    /**
     * W2-JOB-04: when set, job + outbox row are written atomically and the
     * relay publishes — no dual-write createJob→publishDocumentTask.
     */
    private readonly outboxStore?: OutboxStore,
    private readonly options: DocumentGenerationServiceOptions = {},
  ) {}

  /**
   * Bytes of a completed job's PDF (G-902 download link). Null when the job
   * is not completed, belongs to another tenant, or the blob has expired.
   */
  async getJobOutput(
    tenantId: string,
    jobId: string,
  ): Promise<{ job: DocumentGenerationJob; pdf: Buffer } | null> {
    const job = await this.getJobStatus(tenantId, jobId);
    if (job.status !== 'completed' || !job.outputPath) return null;
    const pdf = await this.blobStore.get(job.outputPath);
    return pdf ? { job, pdf } : null;
  }

  /**
   * G-902: admit cards must be printable straight after registration, before
   * any marks/candidate rows exist. Fall back to candidate registrations when
   * the document repository has no enriched candidate rows yet.
   */
  private async resolveCandidates(
    examinationId: string,
    tenantId: string,
    candidateIds?: string[],
  ): Promise<DocumentCandidate[]> {
    const enriched = await this.documentRepository.getDocumentCandidates(
      examinationId,
      tenantId,
      candidateIds,
    );
    if (enriched.length > 0) return enriched;

    const [examination, registrations] = await Promise.all([
      this.examinationRepository.findById(examinationId, tenantId),
      this.examinationRepository.listCandidateRegistrations(examinationId, tenantId),
    ]);
    if (!examination) return [];
    const centerNameById = new Map(examination.centers.map((c) => [c.id, c.name]));
    const subjectNameById = new Map(examination.subjects.map((s) => [s.id, s.name]));
    const wanted = candidateIds && candidateIds.length > 0 ? new Set(candidateIds) : null;
    return registrations
      .filter((r) => !wanted || wanted.has(r.id))
      .map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.studentId,
        rollNumber: r.id.slice(0, 8).toUpperCase(),
        centerId: r.centerId,
        centerName: centerNameById.get(r.centerId) ?? r.centerId,
        subjectIds: r.subjectIds,
        subjectNames: r.subjectIds.map((id) => subjectNameById.get(id) ?? id),
        gender: 'other',
      }));
  }

  /**
   * Request document generation for an examination.
   *
   * Creates a job and either processes it immediately (if batch is small)
   * or queues it via RabbitMQ for background processing.
   *
   * @throws NotFoundError if examination not found
   * @throws BusinessRuleError if examination is not in a valid state for the document type
   * @throws ValidationError if input validation fails
   */
  async requestGeneration(
    tenantId: string,
    examinationId: string,
    input: GenerateDocumentsInput,
  ): Promise<DocumentGenerationJob> {
    return (await this.requestGenerationBatch(tenantId, examinationId, input)).jobs[0]!;
  }

  /**
   * PRC-M236: like {@link requestGeneration} but returns every chunk job. When
   * "all candidates" resolves to more than MAX_BATCH_SIZE, the work is split into
   * ceil(n / MAX_BATCH_SIZE) jobs instead of silently dropping the remainder.
   */
  async requestGenerationBatch(
    tenantId: string,
    examinationId: string,
    input: GenerateDocumentsInput,
  ): Promise<DocumentGenerationBatch> {
    const errors: FieldError[] = [];

    // Fetch examination
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    // Validate document type against examination state
    this.validateDocumentTypeForState(examination.status, input.documentType, errors);

    // Validate batch size
    const candidateIds = input.candidateIds ?? [];
    if (candidateIds.length > MAX_BATCH_SIZE) {
      errors.push({
        field: 'candidateIds',
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} candidates. Received ${candidateIds.length}.`,
        rule: 'maxBatchSize',
      });
    }

    if (errors.length > 0) {
      throw new ValidationError('Document generation validation failed', errors);
    }

    // Determine actual candidate list
    let resolvedCandidateIds = candidateIds;
    if (resolvedCandidateIds.length === 0) {
      // Get all candidates for the examination
      const candidates = await this.resolveCandidates(examinationId, tenantId);
      resolvedCandidateIds = candidates.map((c) => c.id);
    }

    // PRC-M236: split into chunks rather than truncating to MAX_BATCH_SIZE.
    // Seating plans are exam-wide (not per candidate), so they stay one job.
    const chunks: string[][] = [];
    if (input.documentType === 'seating_plan' || resolvedCandidateIds.length <= MAX_BATCH_SIZE) {
      chunks.push(resolvedCandidateIds);
    } else {
      for (let i = 0; i < resolvedCandidateIds.length; i += MAX_BATCH_SIZE) {
        chunks.push(resolvedCandidateIds.slice(i, i + MAX_BATCH_SIZE));
      }
    }

    const jobs: DocumentGenerationJob[] = [];
    for (const chunk of chunks) {
      jobs.push(await this.createQueuedJob(tenantId, examinationId, input.documentType, chunk));
    }
    return { jobs, chunkCount: jobs.length, totalCandidates: resolvedCandidateIds.length };
  }

  private async createQueuedJob(
    tenantId: string,
    examinationId: string,
    documentType: DocumentType,
    candidateIds: string[],
  ): Promise<DocumentGenerationJob> {
    const job: DocumentGenerationJob = {
      id: uuidv4(),
      tenantId,
      examinationId,
      documentType,
      status: 'queued',
      candidateIds,
      totalCandidates: candidateIds.length,
      processedCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };
    const savedJob = this.outboxStore
      ? await this.documentRepository.createJobWithOutbox(
          job,
          buildExamDocumentOutboxEntry({
            tenantId: job.tenantId,
            jobId: job.id,
            examinationId: job.examinationId,
            documentType: job.documentType,
          }),
          this.outboxStore,
        )
      : await this.documentRepository.createJob(job);

    // Legacy dual-write path (tests / NoOp). Prefer outboxStore in production.
    if (!this.outboxStore) {
      await this.taskQueue.publishDocumentTask(savedJob);
    }

    return savedJob;
  }

  /**
   * Process a document generation job.
   *
   * This method is called by the background worker (RabbitMQ consumer)
   * or directly for synchronous processing.
   *
   * @throws NotFoundError if job not found
   */
  async processJob(
    tenantId: string,
    jobId: string,
    processOptions: ProcessDocumentJobOptions = {},
  ): Promise<DocumentGenerationJob> {
    const startTime = Date.now();

    // Get the job (tenant-scoped; another tenant's job is a 404)
    const current = await this.documentRepository.getJob(jobId, tenantId);
    if (!current) {
      throw new NotFoundError(`Document generation job '${jobId}' not found`);
    }

    // PRC-M235: claim queued -> processing atomically; completed/processing/failed
    // jobs are never re-run by a duplicate delivery or a repeated /process call.
    const job = await this.documentRepository.claimJob(
      jobId,
      tenantId,
      new Date(Date.now() - STALE_PROCESSING_MS),
    );
    if (!job) {
      return (await this.documentRepository.getJob(jobId, tenantId)) ?? current;
    }

    try {
      // Fetch examination info
      const examination = await this.examinationRepository.findById(job.examinationId, tenantId);
      if (!examination) {
        throw new NotFoundError(`Examination with id '${job.examinationId}' not found`);
      }

      const examInfo: ExaminationInfo = {
        id: examination.id,
        name: examination.name,
        code: examination.code,
        startDate: examination.startDate,
        endDate: examination.endDate,
        sessions: examination.sessions.map((s) => {
          const subject = examination.subjects.find((sub) => sub.id === s.subjectId);
          return {
            subjectName: subject?.name ?? 'Unknown',
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
          };
        }),
      };

      let pdfBuffer: Buffer;

      switch (job.documentType) {
        case 'admit_card': {
          const candidates = await this.resolveCandidates(
            job.examinationId,
            tenantId,
            job.candidateIds,
          );
          pdfBuffer = await this.pdfGenerator.generateAdmitCards(examInfo, candidates);
          break;
        }
        case 'seating_plan': {
          const assignments = await this.documentRepository.getSeatingAssignments(
            job.examinationId,
            tenantId,
          );
          pdfBuffer = await this.pdfGenerator.generateSeatingPlan(examInfo, assignments);
          break;
        }
        case 'result_certificate': {
          const results = await this.documentRepository.getCandidateResults(
            job.examinationId,
            tenantId,
            job.candidateIds,
          );
          // PRC-H056: never certify a candidate whose subjects are not all graded.
          const incomplete = results.filter((r) => (r.incompleteSubjects?.length ?? 0) > 0);
          if (incomplete.length > 0) {
            throw new BusinessRuleError(
              `Result certificates withheld: ${incomplete.length} candidate(s) have incomplete results (${incomplete
                .slice(0, 10)
                .map((r) => `${r.candidateId}: ${r.incompleteSubjects!.join(', ')}`)
                .join('; ')})`,
            );
          }
          pdfBuffer = await this.pdfGenerator.generateResultCertificates(examInfo, results);
          break;
        }
        default:
          throw new BusinessRuleError(`Unsupported document type: ${String(job.documentType)}`);
      }

      const durationMs = Date.now() - startTime;
      // PRC-M236: surface breaches of the per-batch generation budget.
      if (durationMs > MAX_GENERATION_DURATION_MS) {
        this.options.logger?.warn(
          {
            tenantId,
            jobId,
            documentType: job.documentType,
            durationMs,
            budgetMs: MAX_GENERATION_DURATION_MS,
          },
          'exam document generation exceeded its duration budget',
        );
      }

      // Tenant-prefixed key; the blob store decides where bytes live
      // (in-memory by default, object storage when an adapter is wired).
      const outputPath = `documents/${tenantId}/${job.examinationId}/${job.documentType}_${job.id}.pdf`;
      await this.blobStore.put(outputPath, pdfBuffer);

      const updatedJob = await this.documentRepository.updateJob(jobId, tenantId, {
        status: 'completed',
        processedCount: job.candidateIds.length,
        failedCount: 0,
        outputPath,
        durationMs,
        completedAt: new Date(),
      });

      return updatedJob!;
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (isPermanentDocumentError(error)) {
        // Domain rule failure: terminal, curated message is safe to surface.
        const updatedJob = await this.documentRepository.updateJob(jobId, tenantId, {
          status: 'failed',
          errorMessage: (error as Error).message,
          durationMs,
          completedAt: new Date(),
        });
        return updatedJob!;
      }

      // PRC-M235: transient — release the claim so the job stays retriable and
      // store only a sanitised message (no stack / SQL / driver text).
      const updatedJob = await this.documentRepository.updateJob(jobId, tenantId, {
        status: 'queued',
        errorMessage: GENERIC_DOCUMENT_FAILURE,
        durationMs,
      });
      if (processOptions.rethrowRetryable) throw error;
      return updatedJob ?? job;
    }
  }

  /**
   * Get the status of a document generation job.
   *
   * @throws NotFoundError if job not found
   */
  async getJobStatus(tenantId: string, jobId: string): Promise<DocumentGenerationJob> {
    const job = await this.documentRepository.getJob(jobId, tenantId);
    if (!job) {
      throw new NotFoundError(`Document generation job '${jobId}' not found`);
    }
    return job;
  }

  /**
   * List all document generation jobs for an examination.
   *
   * @throws NotFoundError if examination not found
   */
  async listJobs(tenantId: string, examinationId: string): Promise<DocumentGenerationJob[]> {
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    return this.documentRepository.listJobs(examinationId, tenantId);
  }

  /**
   * Validate that the document type is appropriate for the examination state.
   *
   * - Admit cards: can be generated when examination is SCHEDULED or IN_PROGRESS
   * - Seating plans: can be generated when examination is SCHEDULED or IN_PROGRESS
   * - Result certificates: can only be generated when examination is COMPLETED
   */
  private validateDocumentTypeForState(
    status: string,
    documentType: DocumentType,
    errors: FieldError[],
  ): void {
    switch (documentType) {
      case 'admit_card':
      case 'seating_plan':
        if (status !== 'SCHEDULED' && status !== 'IN_PROGRESS') {
          errors.push({
            field: 'documentType',
            message: `Cannot generate ${documentType.replace('_', ' ')} for examination in '${status}' status. Examination must be SCHEDULED or IN_PROGRESS.`,
            rule: 'examinationStatus',
          });
        }
        break;
      case 'result_certificate':
        if (status !== 'COMPLETED') {
          errors.push({
            field: 'documentType',
            message: `Cannot generate result certificates for examination in '${status}' status. Examination must be COMPLETED.`,
            rule: 'examinationStatus',
          });
        }
        break;
    }
  }
}
