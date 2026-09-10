/**
 * Report Card Service
 *
 * Business logic for report card generation including:
 * - Template management (configurable templates)
 * - Teacher comment management (up to 500 chars per subject)
 * - PDF generation with student results, comments, grade summary, institution branding
 * - Background processing via RabbitMQ task queue
 *
 * Requirements:
 * - 8.7: Generate report cards as PDF using configurable templates with student results
 *         per subject, teacher comments (up to 500 chars), overall grade summary,
 *         and institution logo and name
 */
import { NotFoundError, BusinessRuleError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { AssessmentItemEntity, AssessmentItemRepository } from './assessment-repository.js';
import type { ReportCardArtifactStore } from './report-card-artifact-store.js';
import type {
  ReportCardTemplateEntity,
  ReportCardTemplateRepository,
  TeacherCommentEntity,
  TeacherCommentRepository,
  InstitutionBrandingRepository,
  ReportCardJobEntity,
  ReportCardJobRepository,
} from './report-card-repository.js';
import type {
  CreateReportCardTemplateInput,
  UpdateReportCardTemplateInput,
  UpsertTeacherCommentInput,
  GenerateReportCardInput,
  BulkGenerateReportCardInput,
} from './report-card-schemas.js';
import { MAX_COMMENT_LENGTH } from './report-card-schemas.js';
import type { AssessmentResultRepository, StudentSubjectResult } from './result-repository.js';
import type { ResultService } from './result-service.js';

/**
 * Interface for the task queue publisher (RabbitMQ).
 * Allows dependency injection for testing.
 */
export interface TaskQueuePublisher {
  publish(task: {
    id: string;
    tenantId: string;
    type: string;
    payload: unknown;
    options: { priority: number; delay: number; maxRetries: number; retryCount: number };
  }): Promise<void>;
}

/**
 * Data assembled for PDF generation.
 */
export interface ReportCardData {
  student: {
    id: string;
    name: string;
  };
  institution: {
    name: string;
    logoUrl: string | null;
    address: string | null;
  };
  academicPeriodId: string;
  subjects: Array<{
    subjectId: string;
    subjectName: string;
    items: Array<{
      name: string;
      score: number;
      maxScore: number;
      weight: number;
      weightedScore: number;
    }>;
    weightedAverage: number;
    grade: string;
    gradeDescriptor: string | null;
    teacherComment: string | null;
  }>;
  overallGradeSummary: {
    averageScore: number;
    totalSubjects: number;
    grade: string;
  };
  generatedAt: string;
}

/**
 * Interface for PDF generation (allows swapping implementations).
 */
export interface PdfGenerator {
  generateReportCardPdf(templateContent: string, data: ReportCardData): Promise<Buffer>;
}

/** Optional collaborators for the report-card service (G-716). */
export interface ReportCardServiceOptions {
  /** Persists generated PDF bytes so they can be downloaded later. */
  artifactStore?: ReportCardArtifactStore;
  /**
   * Used to discover which subjects a student has results in for the period,
   * so report cards contain every graded subject rather than an empty list.
   */
  resultRepository?: AssessmentResultRepository;
  /**
   * When true (and no task-queue publisher is configured) jobs are processed
   * immediately after being queued instead of waiting for a worker.
   */
  processInline?: boolean;
}

/** A generated report card ready to be streamed to a client. */
export interface ReportCardPdfArtifact {
  filename: string;
  contentType: 'application/pdf';
  bytes: Buffer;
}

/**
 * Service handling report card business logic.
 */
export class ReportCardService {
  constructor(
    private readonly templateRepo: ReportCardTemplateRepository,
    private readonly commentRepo: TeacherCommentRepository,
    private readonly brandingRepo: InstitutionBrandingRepository,
    private readonly jobRepo: ReportCardJobRepository,
    private readonly resultService: ResultService,
    private readonly assessmentItemRepo: AssessmentItemRepository,
    private readonly taskQueuePublisher: TaskQueuePublisher | null,
    private readonly pdfGenerator: PdfGenerator | null,
    private readonly options: ReportCardServiceOptions = {},
  ) {}

  // ─── Template Operations ─────────────────────────────────────────────────

  /**
   * Create a new report card template.
   */
  async createTemplate(
    tenantId: string,
    input: CreateReportCardTemplateInput,
  ): Promise<ReportCardTemplateEntity> {
    const entity: Omit<ReportCardTemplateEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      templateContent: input.templateContent,
      isDefault: input.isDefault ?? false,
      includeLogo: input.includeLogo ?? true,
      includeGradeSummary: input.includeGradeSummary ?? true,
      includeComments: input.includeComments ?? true,
    };

    return this.templateRepo.create(entity);
  }

  /**
   * Get a template by ID.
   *
   * @throws NotFoundError if not found
   */
  async getTemplate(tenantId: string, id: string): Promise<ReportCardTemplateEntity> {
    const template = await this.templateRepo.findById(id, tenantId);
    if (!template) {
      throw new NotFoundError(`Report card template with id '${id}' not found`);
    }
    return template;
  }

  /**
   * List all templates for a tenant.
   */
  async listTemplates(tenantId: string): Promise<ReportCardTemplateEntity[]> {
    return this.templateRepo.list(tenantId);
  }

  /**
   * Update a template.
   *
   * @throws NotFoundError if not found
   */
  async updateTemplate(
    tenantId: string,
    id: string,
    input: UpdateReportCardTemplateInput,
  ): Promise<ReportCardTemplateEntity> {
    const updated = await this.templateRepo.update(id, tenantId, input);
    if (!updated) {
      throw new NotFoundError(`Report card template with id '${id}' not found`);
    }
    return updated;
  }

  /**
   * Delete a template.
   *
   * @throws NotFoundError if not found
   */
  async deleteTemplate(tenantId: string, id: string): Promise<void> {
    const deleted = await this.templateRepo.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Report card template with id '${id}' not found`);
    }
  }

  // ─── Teacher Comment Operations ──────────────────────────────────────────

  /**
   * Create or update a teacher comment for a student on a subject.
   *
   * Requirement 8.7: Teacher comments up to 500 characters per subject.
   *
   * @throws BusinessRuleError if comment exceeds 500 characters
   */
  async upsertComment(
    tenantId: string,
    input: UpsertTeacherCommentInput,
  ): Promise<TeacherCommentEntity> {
    // Validate comment length
    if (input.comment.length > MAX_COMMENT_LENGTH) {
      throw new BusinessRuleError(
        `Teacher comment must not exceed ${MAX_COMMENT_LENGTH} characters. Current length: ${input.comment.length}`,
      );
    }

    const entity: Omit<TeacherCommentEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      subjectId: input.subjectId,
      academicPeriodId: input.academicPeriodId,
      teacherId: input.teacherId,
      comment: input.comment,
    };

    return this.commentRepo.upsert(entity);
  }

  /**
   * Get all teacher comments for a student in an academic period.
   */
  async getComments(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity[]> {
    return this.commentRepo.findByStudentAndPeriod(tenantId, studentId, academicPeriodId);
  }

  // ─── Report Card Generation ──────────────────────────────────────────────

  /**
   * Queue a report card generation job for background processing.
   *
   * Requirement 8.7: Generate report cards as PDF using configurable templates.
   *
   * @throws NotFoundError if template not found
   */
  async queueReportCardGeneration(
    tenantId: string,
    input: GenerateReportCardInput,
  ): Promise<ReportCardJobEntity> {
    // Resolve template
    let templateId = input.templateId;
    if (!templateId) {
      const defaultTemplate = await this.templateRepo.findDefault(tenantId);
      if (!defaultTemplate) {
        throw new NotFoundError(
          'No default report card template configured. Please specify a templateId or set a default template.',
        );
      }
      templateId = defaultTemplate.id;
    } else {
      const template = await this.templateRepo.findById(templateId, tenantId);
      if (!template) {
        throw new NotFoundError(`Report card template with id '${templateId}' not found`);
      }
    }

    // Create job record
    const job = await this.jobRepo.create({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      academicPeriodId: input.academicPeriodId,
      templateId,
      institutionId: input.institutionId,
      status: 'queued',
      errorMessage: null,
      outputUrl: null,
    });

    // Publish to RabbitMQ for background processing
    if (this.taskQueuePublisher) {
      await this.taskQueuePublisher.publish({
        id: job.id,
        tenantId,
        type: 'report-card.generate',
        payload: {
          jobId: job.id,
          studentId: input.studentId,
          academicPeriodId: input.academicPeriodId,
          templateId,
          institutionId: input.institutionId,
        },
        options: {
          priority: 5,
          delay: 0,
          maxRetries: 3,
          retryCount: 0,
        },
      });
    } else if (this.options.processInline) {
      return this.processReportCardJob(tenantId, job.id);
    }

    return job;
  }

  /**
   * Queue bulk report card generation for multiple students.
   *
   * @throws NotFoundError if template not found
   */
  async queueBulkReportCardGeneration(
    tenantId: string,
    input: BulkGenerateReportCardInput,
  ): Promise<{ totalStudents: number; jobsCreated: number; jobs: ReportCardJobEntity[] }> {
    // Resolve template
    let templateId = input.templateId;
    if (!templateId) {
      const defaultTemplate = await this.templateRepo.findDefault(tenantId);
      if (!defaultTemplate) {
        throw new NotFoundError(
          'No default report card template configured. Please specify a templateId or set a default template.',
        );
      }
      templateId = defaultTemplate.id;
    } else {
      const template = await this.templateRepo.findById(templateId, tenantId);
      if (!template) {
        throw new NotFoundError(`Report card template with id '${templateId}' not found`);
      }
    }

    const jobs: ReportCardJobEntity[] = [];

    for (const studentId of input.studentIds) {
      const job = await this.jobRepo.create({
        id: uuidv4(),
        tenantId,
        studentId,
        academicPeriodId: input.academicPeriodId,
        templateId,
        institutionId: input.institutionId,
        status: 'queued',
        errorMessage: null,
        outputUrl: null,
      });

      // Publish to RabbitMQ
      if (this.taskQueuePublisher) {
        await this.taskQueuePublisher.publish({
          id: job.id,
          tenantId,
          type: 'report-card.generate',
          payload: {
            jobId: job.id,
            studentId,
            academicPeriodId: input.academicPeriodId,
            templateId,
            institutionId: input.institutionId,
          },
          options: {
            priority: 3, // Lower priority for bulk operations
            delay: 0,
            maxRetries: 3,
            retryCount: 0,
          },
        });
      } else if (this.options.processInline) {
        jobs.push(await this.processReportCardJob(tenantId, job.id));
        continue;
      }

      jobs.push(job);
    }

    return {
      totalStudents: input.studentIds.length,
      jobsCreated: jobs.length,
      jobs,
    };
  }

  /**
   * Get the status of a report card generation job.
   *
   * @throws NotFoundError if job not found
   */
  async getJobStatus(tenantId: string, jobId: string): Promise<ReportCardJobEntity> {
    const job = await this.jobRepo.findById(jobId, tenantId);
    if (!job) {
      throw new NotFoundError(`Report card job with id '${jobId}' not found`);
    }
    return job;
  }

  /**
   * Process a report card generation job (called by the background worker).
   *
   * Assembles all data and generates the PDF:
   * - Student results per subject
   * - Teacher comments (up to 500 chars)
   * - Overall grade summary
   * - Institution logo and name
   *
   * Requirement 8.7: Full report card generation.
   */
  async processReportCardJob(tenantId: string, jobId: string): Promise<ReportCardJobEntity> {
    const job = await this.jobRepo.findById(jobId, tenantId);
    if (!job) {
      throw new NotFoundError(`Report card job with id '${jobId}' not found`);
    }

    // Mark as processing
    await this.jobRepo.updateStatus(jobId, tenantId, 'processing');

    try {
      // Get template
      const template = await this.templateRepo.findById(job.templateId, tenantId);
      if (!template) {
        throw new NotFoundError(`Template '${job.templateId}' not found`);
      }

      // Get institution branding
      const branding = await this.brandingRepo.findByInstitutionId(job.institutionId, tenantId);

      // Get all assessment items for the student's subjects in this period
      const subjectResults = await this.assembleStudentResults(
        tenantId,
        job.studentId,
        job.academicPeriodId,
      );

      // Get teacher comments
      const comments = template.includeComments
        ? await this.commentRepo.findByStudentAndPeriod(
            tenantId,
            job.studentId,
            job.academicPeriodId,
          )
        : [];

      // Build comment map (subjectId -> comment)
      const commentMap = new Map<string, string>();
      for (const comment of comments) {
        commentMap.set(comment.subjectId, comment.comment);
      }

      // Calculate overall grade summary
      const overallSummary = this.calculateOverallSummary(subjectResults);

      // Resolve assessment item names / max scores for every item referenced.
      const itemIds = new Set<string>();
      for (const result of subjectResults) {
        for (const item of result.itemScores) itemIds.add(item.assessmentItemId);
      }
      const itemsById = new Map<string, AssessmentItemEntity>();
      for (const itemId of itemIds) {
        const entity = await this.assessmentItemRepo.findById(itemId, tenantId);
        if (entity) itemsById.set(itemId, entity);
      }

      // Assemble report card data
      const reportCardData: ReportCardData = {
        student: {
          id: job.studentId,
          name: '', // Student directory lookup is owned by the student service
        },
        institution: {
          name: branding?.name ?? '',
          logoUrl: template.includeLogo ? (branding?.logoUrl ?? null) : null,
          address: branding?.address ?? null,
        },
        academicPeriodId: job.academicPeriodId,
        subjects: subjectResults.map((result) => ({
          subjectId: result.subjectId,
          subjectName: '', // Subject catalogue lookup is owned by the institution service
          items: result.itemScores.map((item) => {
            const entity = itemsById.get(item.assessmentItemId);
            return {
              name: entity?.name ?? item.assessmentItemId,
              score: item.score,
              maxScore: entity?.maxScore ?? 0,
              weight: item.weight,
              weightedScore: item.weightedScore,
            };
          }),
          weightedAverage: result.weightedAverage,
          grade: result.grade,
          gradeDescriptor: result.gradeDescriptor,
          teacherComment: commentMap.get(result.subjectId) ?? null,
        })),
        overallGradeSummary: overallSummary,
        generatedAt: new Date().toISOString(),
      };

      // Generate PDF and persist the bytes under a tenant-scoped key.
      let outputUrl: string | null = null;
      if (this.pdfGenerator) {
        const pdfBuffer = await this.pdfGenerator.generateReportCardPdf(
          template.templateContent,
          reportCardData,
        );
        outputUrl = ReportCardService.artifactKey(tenantId, job);
        if (this.options.artifactStore) {
          await this.options.artifactStore.put(outputUrl, pdfBuffer);
        }
      }

      // Mark as completed
      const completedJob = await this.jobRepo.updateStatus(jobId, tenantId, 'completed', {
        outputUrl: outputUrl ?? undefined,
        completedAt: new Date(),
      });

      return completedJob!;
    } catch (error: unknown) {
      // Mark as failed
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error during PDF generation';
      const failedJob = await this.jobRepo.updateStatus(jobId, tenantId, 'failed', {
        errorMessage,
      });
      return failedJob!;
    }
  }

  /** Storage key for a job's PDF: `report-cards/<tenant>/<student>/<period>/<job>.pdf`. */
  static artifactKey(
    tenantId: string,
    job: Pick<ReportCardJobEntity, 'id' | 'studentId' | 'academicPeriodId'>,
  ): string {
    return `report-cards/${tenantId}/${job.studentId}/${job.academicPeriodId}/${job.id}.pdf`;
  }

  /**
   * Returns the generated PDF for a completed job.
   *
   * @throws NotFoundError when the job or its artifact does not exist
   * @throws BusinessRuleError when the job has not completed successfully
   */
  async getReportCardPdf(tenantId: string, jobId: string): Promise<ReportCardPdfArtifact> {
    const job = await this.jobRepo.findById(jobId, tenantId);
    if (!job) {
      throw new NotFoundError(`Report card job with id '${jobId}' not found`);
    }
    if (job.status !== 'completed' || !job.outputUrl) {
      throw new BusinessRuleError(
        `Report card job '${jobId}' is ${job.status}; the PDF is not available yet`,
      );
    }
    const store = this.options.artifactStore;
    const bytes = store ? await store.get(job.outputUrl) : null;
    if (!bytes) {
      throw new NotFoundError(`Report card artifact for job '${jobId}' is not available`);
    }
    return {
      filename: `report-card-${job.studentId}-${job.academicPeriodId}.pdf`,
      contentType: 'application/pdf',
      bytes,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Assemble student results across all subjects for a given academic period.
   */
  private async assembleStudentResults(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<StudentSubjectResult[]> {
    const resultRepo = this.options.resultRepository;
    if (!resultRepo) return [];

    const rows = await resultRepo.findByStudentPeriod(tenantId, studentId, academicPeriodId);
    const subjectIds = [...new Set(rows.map((r) => r.subjectId))].sort();

    const results: StudentSubjectResult[] = [];
    for (const subjectId of subjectIds) {
      try {
        results.push(
          await this.resultService.calculateStudentGrade(
            tenantId,
            studentId,
            subjectId,
            academicPeriodId,
          ),
        );
      } catch (error) {
        // A subject whose assessment items or grading scheme were removed
        // cannot be graded; skip it rather than failing the whole card.
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    return results;
  }

  /**
   * Calculate overall grade summary from subject results.
   */
  private calculateOverallSummary(
    subjectResults: StudentSubjectResult[],
  ): ReportCardData['overallGradeSummary'] {
    if (subjectResults.length === 0) {
      return { averageScore: 0, totalSubjects: 0, grade: 'N/A' };
    }

    const totalScore = subjectResults.reduce((sum, r) => sum + r.weightedAverage, 0);
    const averageScore = Math.round((totalScore / subjectResults.length) * 100) / 100;

    // Determine overall grade based on average
    let grade = 'N/A';
    if (averageScore >= 90) grade = 'A';
    else if (averageScore >= 80) grade = 'B';
    else if (averageScore >= 70) grade = 'C';
    else if (averageScore >= 60) grade = 'D';
    else if (averageScore > 0) grade = 'F';

    return {
      averageScore,
      totalSubjects: subjectResults.length,
      grade,
    };
  }
}
