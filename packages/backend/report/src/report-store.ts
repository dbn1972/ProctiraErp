import type { CatalogueReportFormat, CatalogueReportKey } from './catalogue.js';

export type ScheduleCadence = 'daily' | 'weekly' | 'monthly';
export type RunSource = 'manual' | 'schedule';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ReportArtifactRecord {
  id: string;
  tenantId: string;
  reportKey: CatalogueReportKey;
  format: CatalogueReportFormat;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  requestedBy: string;
  createdAt: Date;
}

export interface ReportScheduleRecord {
  id: string;
  tenantId: string;
  reportKey: CatalogueReportKey;
  format: CatalogueReportFormat;
  cadence: ScheduleCadence;
  hour: number;
  nextRunAt: Date;
  recipients: string[];
  enabled: boolean;
  createdBy: string;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportRunRecord {
  id: string;
  tenantId: string;
  scheduleId: string | null;
  artifactId: string | null;
  reportKey: CatalogueReportKey;
  format: CatalogueReportFormat;
  source: RunSource;
  status: RunStatus;
  sha256: string | null;
  objectKey: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ReportStore {
  insertArtifact(record: ReportArtifactRecord): Promise<ReportArtifactRecord>;
  getArtifact(tenantId: string, id: string): Promise<ReportArtifactRecord | null>;
  listArtifacts(tenantId: string, reportKey?: string): Promise<ReportArtifactRecord[]>;

  insertSchedule(record: ReportScheduleRecord): Promise<ReportScheduleRecord>;
  getSchedule(tenantId: string, id: string): Promise<ReportScheduleRecord | null>;
  listSchedules(tenantId: string): Promise<ReportScheduleRecord[]>;
  updateSchedule(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ReportScheduleRecord,
        'enabled' | 'nextRunAt' | 'lastRunAt' | 'recipients' | 'cadence' | 'format' | 'hour'
      >
    >,
  ): Promise<ReportScheduleRecord | null>;
  deleteSchedule(tenantId: string, id: string): Promise<boolean>;
  listDueSchedules(now: Date): Promise<ReportScheduleRecord[]>;
  /**
   * W2-JOB-08: atomically claim due schedules by pushing nextRunAt into a lease
   * window so concurrent replicas cannot double-run the same schedule.
   */
  claimDueSchedules(now: Date, leaseMs: number): Promise<ReportScheduleRecord[]>;

  insertRun(record: ReportRunRecord): Promise<ReportRunRecord>;
  updateRun(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ReportRunRecord,
        'status' | 'artifactId' | 'error' | 'completedAt' | 'sha256' | 'objectKey' | 'sizeBytes'
      >
    >,
  ): Promise<ReportRunRecord | null>;
  listRuns(
    tenantId: string,
    filter?: { reportKey?: string; scheduleId?: string; templateId?: string },
  ): Promise<ReportRunRecord[]>;
}

export class InMemoryReportStore implements ReportStore {
  private artifacts: ReportArtifactRecord[] = [];
  private schedules: ReportScheduleRecord[] = [];
  private runs: ReportRunRecord[] = [];

  async insertArtifact(record: ReportArtifactRecord): Promise<ReportArtifactRecord> {
    const copy = { ...record };
    this.artifacts.push(copy);
    return { ...copy };
  }

  async getArtifact(tenantId: string, id: string): Promise<ReportArtifactRecord | null> {
    const found = this.artifacts.find((a) => a.id === id && a.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async listArtifacts(tenantId: string, reportKey?: string): Promise<ReportArtifactRecord[]> {
    return this.artifacts
      .filter((a) => a.tenantId === tenantId && (!reportKey || a.reportKey === reportKey))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((a) => ({ ...a }));
  }

  async insertSchedule(record: ReportScheduleRecord): Promise<ReportScheduleRecord> {
    const copy = { ...record, recipients: [...record.recipients] };
    this.schedules.push(copy);
    return { ...copy, recipients: [...copy.recipients] };
  }

  async getSchedule(tenantId: string, id: string): Promise<ReportScheduleRecord | null> {
    const found = this.schedules.find((s) => s.id === id && s.tenantId === tenantId);
    return found ? { ...found, recipients: [...found.recipients] } : null;
  }

  async listSchedules(tenantId: string): Promise<ReportScheduleRecord[]> {
    return this.schedules
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((s) => ({ ...s, recipients: [...s.recipients] }));
  }

  async updateSchedule(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ReportScheduleRecord,
        'enabled' | 'nextRunAt' | 'lastRunAt' | 'recipients' | 'cadence' | 'format' | 'hour'
      >
    >,
  ): Promise<ReportScheduleRecord | null> {
    const found = this.schedules.find((s) => s.id === id && s.tenantId === tenantId);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: new Date() });
    if (patch.recipients) found.recipients = [...patch.recipients];
    return { ...found, recipients: [...found.recipients] };
  }

  async deleteSchedule(tenantId: string, id: string): Promise<boolean> {
    const idx = this.schedules.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (idx < 0) return false;
    this.schedules.splice(idx, 1);
    return true;
  }

  async listDueSchedules(now: Date): Promise<ReportScheduleRecord[]> {
    return this.schedules
      .filter((s) => s.enabled && s.nextRunAt.getTime() <= now.getTime())
      .map((s) => ({ ...s, recipients: [...s.recipients] }));
  }

  async claimDueSchedules(now: Date, leaseMs: number): Promise<ReportScheduleRecord[]> {
    const leaseUntil = new Date(now.getTime() + Math.max(1_000, leaseMs));
    const claimed: ReportScheduleRecord[] = [];
    for (const s of this.schedules) {
      if (!s.enabled || s.nextRunAt.getTime() > now.getTime()) continue;
      s.nextRunAt = leaseUntil;
      s.updatedAt = new Date(now.getTime());
      claimed.push({ ...s, recipients: [...s.recipients] });
    }
    return claimed;
  }

  async insertRun(record: ReportRunRecord): Promise<ReportRunRecord> {
    const copy = { ...record };
    this.runs.push(copy);
    return { ...copy };
  }

  async updateRun(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ReportRunRecord,
        'status' | 'artifactId' | 'error' | 'completedAt' | 'sha256' | 'objectKey' | 'sizeBytes'
      >
    >,
  ): Promise<ReportRunRecord | null> {
    const found = this.runs.find((r) => r.id === id && r.tenantId === tenantId);
    if (!found) return null;
    Object.assign(found, patch);
    return { ...found };
  }

  async listRuns(
    tenantId: string,
    filter?: { reportKey?: string; scheduleId?: string; templateId?: string },
  ): Promise<ReportRunRecord[]> {
    return this.runs
      .filter((r) => {
        if (r.tenantId !== tenantId) return false;
        if (filter?.scheduleId && r.scheduleId !== filter.scheduleId) return false;
        if (filter?.reportKey && r.reportKey !== filter.reportKey) return false;
        if (
          filter?.templateId &&
          r.reportKey !== filter.templateId &&
          r.reportKey !== filter.templateId
        ) {
          // template aliases resolved by caller
          return r.reportKey === filter.templateId;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  clear(): void {
    this.artifacts = [];
    this.schedules = [];
    this.runs = [];
  }
}
