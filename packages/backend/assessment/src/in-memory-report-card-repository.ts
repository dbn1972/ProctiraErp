/**
 * In-Memory Report Card Repository Implementations
 *
 * Used for testing the report card service without a database.
 */
import type {
  ReportCardTemplateEntity,
  ReportCardTemplateRepository,
  TeacherCommentEntity,
  TeacherCommentRepository,
  InstitutionBrandingEntity,
  InstitutionBrandingRepository,
  ReportCardJobEntity,
  ReportCardJobRepository,
  ReportCardJobStatus,
} from './report-card-repository.js';

/**
 * In-memory implementation of ReportCardTemplateRepository.
 */
export class InMemoryReportCardTemplateRepository implements ReportCardTemplateRepository {
  private templates: ReportCardTemplateEntity[] = [];

  async create(data: Omit<ReportCardTemplateEntity, 'createdAt' | 'updatedAt'>): Promise<ReportCardTemplateEntity> {
    const entity: ReportCardTemplateEntity = {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.templates.push(entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<ReportCardTemplateEntity | null> {
    return this.templates.find((t) => t.id === id && t.tenantId === tenantId) ?? null;
  }

  async findDefault(tenantId: string): Promise<ReportCardTemplateEntity | null> {
    return this.templates.find((t) => t.tenantId === tenantId && t.isDefault) ?? null;
  }

  async list(tenantId: string): Promise<ReportCardTemplateEntity[]> {
    return this.templates.filter((t) => t.tenantId === tenantId);
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ReportCardTemplateEntity>,
  ): Promise<ReportCardTemplateEntity | null> {
    const index = this.templates.findIndex((t) => t.id === id && t.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.templates[index]!;
    const updated: ReportCardTemplateEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.templates[index] = updated;
    return updated;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const index = this.templates.findIndex((t) => t.id === id && t.tenantId === tenantId);
    if (index === -1) return false;
    this.templates.splice(index, 1);
    return true;
  }

  /** Reset for testing */
  clear(): void {
    this.templates = [];
  }
}

/**
 * In-memory implementation of TeacherCommentRepository.
 */
export class InMemoryTeacherCommentRepository implements TeacherCommentRepository {
  private comments: TeacherCommentEntity[] = [];

  async upsert(data: Omit<TeacherCommentEntity, 'createdAt' | 'updatedAt'>): Promise<TeacherCommentEntity> {
    // Check if a comment already exists for this student+subject+period
    const existingIndex = this.comments.findIndex(
      (c) =>
        c.tenantId === data.tenantId &&
        c.studentId === data.studentId &&
        c.subjectId === data.subjectId &&
        c.academicPeriodId === data.academicPeriodId,
    );

    const entity: TeacherCommentEntity = {
      ...data,
      createdAt: existingIndex >= 0 ? this.comments[existingIndex]!.createdAt : new Date(),
      updatedAt: new Date(),
    };

    if (existingIndex >= 0) {
      // Update existing - keep the original ID
      entity.id = this.comments[existingIndex]!.id;
      this.comments[existingIndex] = entity;
    } else {
      this.comments.push(entity);
    }

    return entity;
  }

  async findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity[]> {
    return this.comments.filter(
      (c) =>
        c.tenantId === tenantId &&
        c.studentId === studentId &&
        c.academicPeriodId === academicPeriodId,
    );
  }

  async findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity | null> {
    return (
      this.comments.find(
        (c) =>
          c.tenantId === tenantId &&
          c.studentId === studentId &&
          c.subjectId === subjectId &&
          c.academicPeriodId === academicPeriodId,
      ) ?? null
    );
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (index === -1) return false;
    this.comments.splice(index, 1);
    return true;
  }

  /** Reset for testing */
  clear(): void {
    this.comments = [];
  }
}

/**
 * In-memory implementation of InstitutionBrandingRepository.
 */
export class InMemoryInstitutionBrandingRepository implements InstitutionBrandingRepository {
  private brandings: InstitutionBrandingEntity[] = [];

  async findByInstitutionId(
    institutionId: string,
    tenantId: string,
  ): Promise<InstitutionBrandingEntity | null> {
    return (
      this.brandings.find(
        (b) => b.institutionId === institutionId && b.tenantId === tenantId,
      ) ?? null
    );
  }

  /** Add branding data for testing */
  addBranding(branding: InstitutionBrandingEntity): void {
    this.brandings.push(branding);
  }

  /** Reset for testing */
  clear(): void {
    this.brandings = [];
  }
}

/**
 * In-memory implementation of ReportCardJobRepository.
 */
export class InMemoryReportCardJobRepository implements ReportCardJobRepository {
  private jobs: ReportCardJobEntity[] = [];

  async create(
    data: Omit<ReportCardJobEntity, 'createdAt' | 'updatedAt' | 'completedAt'>,
  ): Promise<ReportCardJobEntity> {
    const entity: ReportCardJobEntity = {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    };
    this.jobs.push(entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<ReportCardJobEntity | null> {
    return this.jobs.find((j) => j.id === id && j.tenantId === tenantId) ?? null;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: ReportCardJobStatus,
    details?: { errorMessage?: string; outputUrl?: string; completedAt?: Date },
  ): Promise<ReportCardJobEntity | null> {
    const index = this.jobs.findIndex((j) => j.id === id && j.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.jobs[index]!;
    const updated: ReportCardJobEntity = {
      ...existing,
      status,
      errorMessage: details?.errorMessage ?? existing.errorMessage,
      outputUrl: details?.outputUrl ?? existing.outputUrl,
      completedAt: details?.completedAt ?? existing.completedAt,
      updatedAt: new Date(),
    };
    this.jobs[index] = updated;
    return updated;
  }

  async findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<ReportCardJobEntity[]> {
    return this.jobs.filter(
      (j) =>
        j.tenantId === tenantId &&
        j.studentId === studentId &&
        j.academicPeriodId === academicPeriodId,
    );
  }

  /** Reset for testing */
  clear(): void {
    this.jobs = [];
  }
}
