import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import type { ReportBlobStore } from './blob-store.js';
import {
  catalogueEntryFor,
  findCatalogueEntry,
  formatApiLabel,
  REPORT_CATALOGUE,
  resolveReportKey,
  type CatalogueReportFormat,
} from './catalogue.js';
import {
  buildRoleDashboard,
  loadDashboardAggregates,
  resolveDashboardRole,
  valuesForRole,
  type RoleDashboard,
} from './dashboards.js';
import { contentTypeFor, filenameFor, generateReportBytes, sha256Hex } from './generators.js';
import { fetchCatalogueTable } from './providers.js';
import type {
  ReportArtifactRecord,
  ReportRunRecord,
  ReportScheduleRecord,
  ReportStore,
  ScheduleCadence,
} from './report-store.js';
import { computeNextRunAt } from './scheduler.js';
import { createReportDownloadToken } from './signed-download.js';

export interface GenerateInput {
  reportKey?: string;
  templateId?: string;
  format: string;
  filters?: Record<string, unknown>;
}

export interface GenerateResult {
  artifact: ReportArtifactRecord;
  run: ReportRunRecord;
  downloadUrl: string;
  downloadToken: string;
  bytes: Buffer;
}

export class CatalogueService {
  constructor(
    private readonly store: ReportStore,
    private readonly blobs: ReportBlobStore,
  ) {}

  listCatalogue() {
    return REPORT_CATALOGUE.map((e) => ({ ...e, format: [...e.format] }));
  }

  getCatalogueEntry(id: string) {
    return findCatalogueEntry(id);
  }

  async generate(
    tenantId: string,
    actorId: string,
    input: GenerateInput,
    options: { source?: 'manual' | 'schedule'; scheduleId?: string | null } = {},
  ): Promise<GenerateResult> {
    const reportKey = resolveReportKey(input);
    if (!reportKey) {
      throw new ValidationError('Unknown report key', [
        { field: 'reportKey', rule: 'enum', message: 'Must be a catalogue report' },
      ]);
    }
    const format = input.format.trim().toLowerCase() as CatalogueReportFormat;
    if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
      throw new ValidationError('Unsupported format', [
        { field: 'format', rule: 'enum', message: 'Must be csv, xlsx, or pdf' },
      ]);
    }

    const source = options.source ?? 'manual';
    const runId = randomUUID();
    const artifactId = randomUUID();
    const now = new Date();
    await this.store.insertRun({
      id: runId,
      tenantId,
      scheduleId: options.scheduleId ?? null,
      artifactId: null,
      reportKey,
      format,
      source,
      status: 'running',
      sha256: null,
      objectKey: null,
      sizeBytes: null,
      error: null,
      createdAt: now,
      completedAt: null,
    });

    try {
      const table = await fetchCatalogueTable(tenantId, reportKey, input.filters ?? {});
      const bytes = await generateReportBytes(reportKey, format, table);
      const digest = sha256Hex(bytes);
      const objectKey = `${tenantId}/reports/${artifactId}.${format}`;
      await this.blobs.put(objectKey, bytes);
      const artifact = await this.store.insertArtifact({
        id: artifactId,
        tenantId,
        reportKey,
        format,
        objectKey,
        sha256: digest,
        sizeBytes: bytes.length,
        requestedBy: actorId,
        createdAt: now,
      });
      const run = await this.store.updateRun(tenantId, runId, {
        status: 'completed',
        artifactId,
        sha256: digest,
        objectKey,
        sizeBytes: bytes.length,
        completedAt: new Date(),
      });
      const signed = createReportDownloadToken(tenantId, artifactId);
      return {
        artifact,
        run: run!,
        downloadUrl: `/api/v1/reports/artifacts/${artifactId}/download?token=${signed.token}`,
        downloadToken: signed.token,
        bytes,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.store.updateRun(tenantId, runId, {
        status: 'failed',
        error: message,
        completedAt: new Date(),
      });
      throw error;
    }
  }

  async getArtifact(tenantId: string, id: string): Promise<ReportArtifactRecord> {
    const artifact = await this.store.getArtifact(tenantId, id);
    if (!artifact) throw new NotFoundError(`Report artifact '${id}' not found`);
    return artifact;
  }

  async downloadBytes(tenantId: string, id: string): Promise<{
    artifact: ReportArtifactRecord;
    bytes: Buffer;
    contentType: string;
    filename: string;
  }> {
    const artifact = await this.getArtifact(tenantId, id);
    const bytes = await this.blobs.get(artifact.objectKey);
    if (!bytes) throw new NotFoundError(`Report file for artifact '${id}' not found`);
    if (sha256Hex(bytes) !== artifact.sha256) {
      throw new ValidationError('Artifact hash mismatch', [
        { field: 'sha256', rule: 'integrity', message: 'Stored hash does not match file bytes' },
      ]);
    }
    return {
      artifact,
      bytes,
      contentType: contentTypeFor(artifact.format),
      filename: filenameFor(artifact.reportKey, artifact.format),
    };
  }

  async listRuns(
    tenantId: string,
    filter?: { reportKey?: string; scheduleId?: string; templateId?: string },
  ) {
    const fromTemplate = filter?.templateId
      ? resolveReportKey({ templateId: filter.templateId })
      : null;
    const reportKey = filter?.reportKey ?? fromTemplate ?? undefined;
    return this.store.listRuns(tenantId, {
      reportKey: reportKey,
      scheduleId: filter?.scheduleId,
    });
  }

  async createSchedule(
    tenantId: string,
    actorId: string,
    input: {
      reportKey: string;
      format: string;
      cadence: string;
      hour?: number;
      recipients?: string[];
      enabled?: boolean;
    },
  ): Promise<ReportScheduleRecord> {
    const reportKey = resolveReportKey({ reportKey: input.reportKey, templateId: input.reportKey });
    if (!reportKey) {
      throw new ValidationError('Unknown report key', [
        { field: 'reportKey', rule: 'enum', message: 'Must be a catalogue report' },
      ]);
    }
    const format = input.format.trim().toLowerCase() as CatalogueReportFormat;
    if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
      throw new ValidationError('Unsupported format', [
        { field: 'format', rule: 'enum', message: 'Must be csv, xlsx, or pdf' },
      ]);
    }
    const cadence = input.cadence.trim().toLowerCase() as ScheduleCadence;
    if (cadence !== 'daily' && cadence !== 'weekly' && cadence !== 'monthly') {
      throw new ValidationError('Unsupported cadence', [
        { field: 'cadence', rule: 'enum', message: 'Must be daily, weekly, or monthly' },
      ]);
    }
    const now = new Date();
    const hour = Number.isFinite(input.hour) ? Math.min(23, Math.max(0, Math.trunc(input.hour!))) : 6;
    return this.store.insertSchedule({
      id: randomUUID(),
      tenantId,
      reportKey,
      format,
      cadence,
      hour,
      nextRunAt: computeNextRunAt(cadence, now, hour),
      recipients: input.recipients ?? [],
      enabled: input.enabled ?? true,
      createdBy: actorId,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  listSchedules(tenantId: string) {
    return this.store.listSchedules(tenantId);
  }

  async setScheduleEnabled(tenantId: string, id: string, enabled: boolean) {
    const existing = await this.store.getSchedule(tenantId, id);
    if (!existing) throw new NotFoundError(`Schedule '${id}' not found`);
    const updated = await this.store.updateSchedule(tenantId, id, { enabled });
    if (!updated) throw new NotFoundError(`Schedule '${id}' not found`);
    return updated;
  }

  async deleteSchedule(tenantId: string, id: string): Promise<void> {
    const deleted = await this.store.deleteSchedule(tenantId, id);
    if (!deleted) throw new NotFoundError(`Schedule '${id}' not found`);
  }

  async dashboard(
    tenantId: string,
    roles: Array<{ roleId?: string; roleName?: string }> | undefined,
    queryRole?: string | null,
  ): Promise<RoleDashboard> {
    const role = resolveDashboardRole(roles, queryRole);
    const agg = await loadDashboardAggregates(tenantId);
    return buildRoleDashboard(role, valuesForRole(role, agg));
  }

  /** Job-runner entry: execute every enabled schedule whose next_run_at <= now. */
  async runDue(now = new Date()): Promise<{ due: number; completed: number; failed: number }> {
    return this.tickDueSchedules(now);
  }

  async tickDueSchedules(now = new Date()): Promise<{ due: number; completed: number; failed: number }> {
    const due = await this.store.listDueSchedules(now);
    let completed = 0;
    let failed = 0;
    for (const schedule of due) {
      try {
        await this.generate(schedule.tenantId, schedule.createdBy, {
          reportKey: schedule.reportKey,
          format: schedule.format,
        }, { source: 'schedule', scheduleId: schedule.id });
        await this.store.updateSchedule(schedule.tenantId, schedule.id, {
          lastRunAt: now,
          nextRunAt: computeNextRunAt(schedule.cadence, now, schedule.hour),
        });
        completed += 1;
      } catch {
        failed += 1;
        await this.store.updateSchedule(schedule.tenantId, schedule.id, {
          lastRunAt: now,
          nextRunAt: computeNextRunAt(schedule.cadence, now, schedule.hour),
        });
      }
    }
    return { due: due.length, completed, failed };
  }

  toInsightsRun(result: GenerateResult, requestedBy: string) {
    const entry = catalogueEntryFor(result.artifact.reportKey);
    return {
      id: result.run.id,
      templateId: entry.id,
      templateName: entry.name,
      generatedAt: result.artifact.createdAt.toISOString(),
      generatedBy: requestedBy,
      format: formatApiLabel(result.artifact.format),
      fileSizeKb: Math.max(1, Math.round(result.artifact.sizeBytes / 1024)),
      status: 'READY' as const,
      downloadUrl: result.downloadUrl,
      artifactId: result.artifact.id,
      sha256: result.artifact.sha256,
      trigger: result.run.source,
    };
  }

  toInsightsRunFromRecords(
    run: ReportRunRecord,
    artifact: ReportArtifactRecord | null,
    requestedBy: string,
  ) {
    const entry = catalogueEntryFor(run.reportKey);
    return {
      id: run.id,
      templateId: entry.id,
      templateName: entry.name,
      generatedAt: run.createdAt.toISOString(),
      generatedBy: requestedBy,
      format: formatApiLabel(run.format),
      fileSizeKb: artifact ? Math.max(1, Math.round(artifact.sizeBytes / 1024)) : 0,
      status:
        run.status === 'completed'
          ? ('READY' as const)
          : run.status === 'failed'
            ? ('FAILED' as const)
            : run.status === 'running'
              ? ('RUNNING' as const)
              : ('QUEUED' as const),
      downloadUrl: artifact
        ? `/api/v1/reports/artifacts/${artifact.id}/download`
        : null,
      artifactId: artifact?.id ?? null,
      sha256: artifact?.sha256 ?? run.sha256 ?? null,
      trigger: run.source,
    };
  }
}
