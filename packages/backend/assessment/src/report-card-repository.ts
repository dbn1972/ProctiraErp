/**
 * Report Card Repository Interfaces
 *
 * Defines the data access contracts for report card operations including:
 * - Report card template management (configurable templates)
 * - Report card generation job tracking
 * - Teacher comments per subject
 * - Institution branding (logo, name)
 *
 * Requirements: 8.7
 */

/**
 * A configurable report card template.
 */
export interface ReportCardTemplateEntity {
  id: string;
  tenantId: string;
  name: string;
  /** Template content/layout definition (HTML/Handlebars template) */
  templateContent: string;
  /** Whether this template is the default for the tenant */
  isDefault: boolean;
  /** Whether to include institution logo */
  includeLogo: boolean;
  /** Whether to include overall grade summary */
  includeGradeSummary: boolean;
  /** Whether to include teacher comments */
  includeComments: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Teacher comment for a student on a specific subject in an academic period.
 */
export interface TeacherCommentEntity {
  id: string;
  tenantId: string;
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  teacherId: string;
  /** Comment text (max 500 characters) */
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Institution branding information for report cards.
 */
export interface InstitutionBrandingEntity {
  institutionId: string;
  tenantId: string;
  name: string;
  /** URL or base64-encoded logo image */
  logoUrl: string | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

/**
 * Status of a report card generation job.
 */
export type ReportCardJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * A report card generation job entity.
 */
export interface ReportCardJobEntity {
  id: string;
  tenantId: string;
  studentId: string;
  academicPeriodId: string;
  templateId: string;
  institutionId: string;
  status: ReportCardJobStatus;
  /** Error message if status is 'failed' */
  errorMessage: string | null;
  /** URL or path to the generated PDF */
  outputUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/**
 * Repository interface for report card template data access.
 */
export interface ReportCardTemplateRepository {
  /** Create a new template */
  create(
    data: Omit<ReportCardTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ReportCardTemplateEntity>;

  /** Find a template by ID within a tenant */
  findById(id: string, tenantId: string): Promise<ReportCardTemplateEntity | null>;

  /** Find the default template for a tenant */
  findDefault(tenantId: string): Promise<ReportCardTemplateEntity | null>;

  /** List all templates for a tenant */
  list(tenantId: string): Promise<ReportCardTemplateEntity[]>;

  /** Update a template */
  update(
    id: string,
    tenantId: string,
    data: Partial<ReportCardTemplateEntity>,
  ): Promise<ReportCardTemplateEntity | null>;

  /** Delete a template */
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for teacher comment data access.
 */
export interface TeacherCommentRepository {
  /** Create or update a teacher comment */
  upsert(
    data: Omit<TeacherCommentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TeacherCommentEntity>;

  /** Find comments for a student in an academic period */
  findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity[]>;

  /** Find a specific comment */
  findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity | null>;

  /** Delete a comment */
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for institution branding data access.
 */
export interface InstitutionBrandingRepository {
  /** Get branding info for an institution */
  findByInstitutionId(
    institutionId: string,
    tenantId: string,
  ): Promise<InstitutionBrandingEntity | null>;
}

/**
 * Repository interface for report card job tracking.
 */
export interface ReportCardJobRepository {
  /** Create a new job */
  create(
    data: Omit<ReportCardJobEntity, 'createdAt' | 'updatedAt' | 'completedAt'>,
  ): Promise<ReportCardJobEntity>;

  /** Find a job by ID */
  findById(id: string, tenantId: string): Promise<ReportCardJobEntity | null>;

  /** Update job status */
  updateStatus(
    id: string,
    tenantId: string,
    status: ReportCardJobStatus,
    details?: { errorMessage?: string; outputUrl?: string; completedAt?: Date },
  ): Promise<ReportCardJobEntity | null>;

  /** Find jobs for a student in an academic period */
  findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<ReportCardJobEntity[]>;

  /**
   * List jobs by status (W2-JOB-02 reclaim of orphaned `queued` rows after
   * create→publish dual-write crash).
   */
  listByStatus(tenantId: string, status: ReportCardJobStatus): Promise<ReportCardJobEntity[]>;
}
