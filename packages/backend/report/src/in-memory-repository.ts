/**
 * In-Memory Report Repository
 *
 * Used for unit testing and development without external dependencies.
 */
import type {
  ReportRepository,
  ReportJobEntity,
  ReportTemplateEntity,
  ScheduledReportEntity,
  ReportJobQueryOptions,
  PaginatedReportJobs,
} from './report-repository.js';

export class InMemoryReportRepository implements ReportRepository {
  private jobs: ReportJobEntity[] = [];
  private templates: ReportTemplateEntity[] = [];
  private schedules: ScheduledReportEntity[] = [];

  // ─── Report Jobs ─────────────────────────────────────────────────────────

  async createJob(entity: ReportJobEntity): Promise<ReportJobEntity> {
    this.jobs.push({ ...entity });
    return { ...entity };
  }

  async getJobById(tenantId: string, id: string): Promise<ReportJobEntity | null> {
    const found = this.jobs.find((j) => j.id === id && j.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async updateJob(
    id: string,
    tenantId: string,
    update: Partial<Omit<ReportJobEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ReportJobEntity | null> {
    const index = this.jobs.findIndex((j) => j.id === id && j.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.jobs[index]!;
    const updated: ReportJobEntity = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };

    this.jobs[index] = updated;
    return { ...updated };
  }

  async listJobs(
    tenantId: string,
    requestedBy: string,
    options: ReportJobQueryOptions,
  ): Promise<PaginatedReportJobs> {
    let filtered = this.jobs.filter(
      (j) => j.tenantId === tenantId && j.requestedBy === requestedBy,
    );

    if (options.status) {
      filtered = filtered.filter((j) => j.status === options.status);
    }
    if (options.reportType) {
      filtered = filtered.filter((j) => j.reportType === options.reportType);
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = filtered.length;
    const totalPages = Math.ceil(total / options.pageSize);
    const start = (options.page - 1) * options.pageSize;
    const data = filtered.slice(start, start + options.pageSize);

    return {
      data: data.map((j) => ({ ...j })),
      total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages,
    };
  }

  // ─── Report Templates ──────────────────────────────────────────────────

  async createTemplate(entity: ReportTemplateEntity): Promise<ReportTemplateEntity> {
    this.templates.push({ ...entity });
    return { ...entity };
  }

  async getTemplateById(tenantId: string, id: string): Promise<ReportTemplateEntity | null> {
    const found = this.templates.find((t) => t.id === id && t.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async updateTemplate(
    id: string,
    tenantId: string,
    update: Partial<Omit<ReportTemplateEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ReportTemplateEntity | null> {
    const index = this.templates.findIndex((t) => t.id === id && t.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.templates[index]!;
    const updated: ReportTemplateEntity = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };

    this.templates[index] = updated;
    return { ...updated };
  }

  async deleteTemplate(tenantId: string, id: string): Promise<boolean> {
    const index = this.templates.findIndex((t) => t.id === id && t.tenantId === tenantId);
    if (index === -1) return false;
    this.templates.splice(index, 1);
    return true;
  }

  async listTemplates(tenantId: string): Promise<ReportTemplateEntity[]> {
    return this.templates.filter((t) => t.tenantId === tenantId).map((t) => ({ ...t }));
  }

  // ─── Scheduled Reports ─────────────────────────────────────────────────

  async createSchedule(entity: ScheduledReportEntity): Promise<ScheduledReportEntity> {
    this.schedules.push({ ...entity });
    return { ...entity };
  }

  async getScheduleById(tenantId: string, id: string): Promise<ScheduledReportEntity | null> {
    const found = this.schedules.find((s) => s.id === id && s.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async updateSchedule(
    id: string,
    tenantId: string,
    update: Partial<Omit<ScheduledReportEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ScheduledReportEntity | null> {
    const index = this.schedules.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.schedules[index]!;
    const updated: ScheduledReportEntity = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };

    this.schedules[index] = updated;
    return { ...updated };
  }

  async deleteSchedule(tenantId: string, id: string): Promise<boolean> {
    const index = this.schedules.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) return false;
    this.schedules.splice(index, 1);
    return true;
  }

  async listSchedules(tenantId: string): Promise<ScheduledReportEntity[]> {
    return this.schedules.filter((s) => s.tenantId === tenantId).map((s) => ({ ...s }));
  }

  async getDueSchedules(currentTime: Date): Promise<ScheduledReportEntity[]> {
    return this.schedules
      .filter((s) => s.isActive && s.nextRunAt !== null && s.nextRunAt <= currentTime)
      .map((s) => ({ ...s }));
  }

  // ─── Test Helpers ──────────────────────────────────────────────────────

  /** Clear all data (for test isolation) */
  clear(): void {
    this.jobs = [];
    this.templates = [];
    this.schedules = [];
  }
}
