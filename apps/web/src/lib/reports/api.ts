/**
 * Reports / BI catalogue client (G-909).
 *
 * Server-only — wraps `gatewayFetch` for templates, generate, runs,
 * artifacts, schedules, and role dashboards.
 */
import { gatewayFetch } from '@/lib/api/gateway';
import { scaffoldSourceFromResponse, type ScaffoldDataSource } from '@/lib/api/insights-source';

export type { ScaffoldDataSource };

export type ReportFormat = 'PDF' | 'XLSX' | 'CSV';
export type DashboardRole = 'board' | 'principal' | 'teacher' | 'parent';
export type ScheduleCadence = 'daily' | 'weekly' | 'monthly';

export interface ReportFilter {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'number';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface ReportTemplate {
  id: string;
  reportKey?: string;
  name: string;
  description: string;
  module: string;
  format: ReportFormat[];
  filters: ReportFilter[];
}

export interface ReportRun {
  id: string;
  templateId: string;
  templateName: string;
  generatedAt: string;
  generatedBy: string;
  format: ReportFormat;
  fileSizeKb: number;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  downloadUrl: string | null;
  artifactId?: string | null;
  sha256?: string | null;
  trigger?: string | null;
}

export interface ReportSchedule {
  id: string;
  tenantId: string;
  reportKey: string;
  format: string;
  cadence: ScheduleCadence;
  hour: number;
  nextRunAt: string;
  recipients: string[];
  enabled: boolean;
  createdBy: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDashboardCard {
  id: string;
  title: string;
  value: string;
  hint: string;
}

export interface RoleDashboard {
  role: DashboardRole;
  title: string;
  cards: RoleDashboardCard[];
}

export interface GenerateReportInput {
  templateId?: string;
  reportKey?: string;
  format: ReportFormat;
  filters?: Record<string, string>;
}

export interface CreateReportScheduleInput {
  reportKey: string;
  format: string;
  cadence: ScheduleCadence;
  hour?: number;
  recipients?: string[];
  enabled?: boolean;
}

function webDownloadUrl(artifactId: string | null | undefined): string | null {
  if (!artifactId) return null;
  return `/api/reports/artifacts/${artifactId}/download`;
}

function withWebDownload(run: ReportRun): ReportRun {
  return {
    ...run,
    downloadUrl: webDownloadUrl(run.artifactId) ?? run.downloadUrl,
  };
}

export async function listReportTemplates(): Promise<{
  templates: ReportTemplate[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: ReportTemplate[] }>('/reports/templates', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { templates: result.data?.data ?? [], source: 'gateway' };
  }
  return { templates: [], source: 'scaffold' };
}

export async function getReportTemplate(id: string): Promise<{
  template: ReportTemplate | null;
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<ReportTemplate>(`/reports/templates/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { template: result.data, source: 'gateway' };
  }
  return {
    template: null,
    source: scaffoldSourceFromResponse(false, result.status),
  };
}

export async function listReportRuns(templateId?: string): Promise<{
  runs: ReportRun[];
  source: ScaffoldDataSource;
}> {
  const path = templateId
    ? `/reports/runs?templateId=${encodeURIComponent(templateId)}`
    : '/reports/runs';
  const result = await gatewayFetch<{ data: ReportRun[] }>(path, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { runs: (result.data?.data ?? []).map(withWebDownload), source: 'gateway' };
  }
  return { runs: [], source: 'scaffold' };
}

export async function generateReport(input: GenerateReportInput): Promise<{
  run: ReportRun | null;
  source: ScaffoldDataSource;
  error?: string;
}> {
  const result = await gatewayFetch<ReportRun>('/reports/generate', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { run: withWebDownload(result.data), source: 'gateway' };
  }
  return {
    run: null,
    source: scaffoldSourceFromResponse(false, result.status),
    error: result.error?.message ?? 'Failed to generate report',
  };
}

export async function listReportSchedules(): Promise<{
  schedules: ReportSchedule[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: ReportSchedule[] }>('/reports/schedules', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { schedules: result.data?.data ?? [], source: 'gateway' };
  }
  return { schedules: [], source: 'scaffold' };
}

export async function createReportSchedule(input: CreateReportScheduleInput): Promise<{
  schedule: ReportSchedule | null;
  source: ScaffoldDataSource;
  error?: string;
}> {
  const result = await gatewayFetch<ReportSchedule>('/reports/schedules', {
    method: 'POST',
    json: {
      ...input,
      format: String(input.format).toLowerCase(),
    },
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { schedule: result.data, source: 'gateway' };
  }
  return {
    schedule: null,
    source: scaffoldSourceFromResponse(false, result.status),
    error: result.error?.message ?? 'Failed to create schedule',
  };
}

export async function setReportScheduleEnabled(
  scheduleId: string,
  enabled: boolean,
): Promise<{
  schedule: ReportSchedule | null;
  error?: string;
}> {
  const result = await gatewayFetch<ReportSchedule>(`/reports/schedules/${scheduleId}`, {
    method: 'PATCH',
    json: { enabled },
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { schedule: result.data };
  }
  return { schedule: null, error: result.error?.message ?? 'Failed to update schedule' };
}

export async function deleteReportSchedule(
  scheduleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await gatewayFetch<unknown>(`/reports/schedules/${scheduleId}`, {
    method: 'DELETE',
    throwOnError: false,
  });
  if (result.ok || result.status === 204) return { ok: true };
  return { ok: false, error: result.error?.message ?? 'Failed to delete schedule' };
}

export async function runReportSchedule(scheduleId: string): Promise<{
  run: ReportRun | null;
  error?: string;
}> {
  const result = await gatewayFetch<ReportRun>(`/reports/schedules/${scheduleId}/run`, {
    method: 'POST',
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { run: withWebDownload(result.data) };
  }
  return { run: null, error: result.error?.message ?? 'Failed to run schedule' };
}

export async function runDueReportSchedules(): Promise<{
  due: number;
  completed: number;
  failed: number;
} | null> {
  const result = await gatewayFetch<{ due: number; completed: number; failed: number }>(
    '/reports/schedules/run-due',
    { method: 'POST', throwOnError: false },
  );
  if (result.ok && result.data) return result.data;
  return null;
}

export async function getRoleDashboard(role?: DashboardRole | null): Promise<{
  dashboard: RoleDashboard | null;
  source: ScaffoldDataSource;
  status: number;
  error?: string;
}> {
  const qs = role ? `?role=${encodeURIComponent(role)}` : '';
  const result = await gatewayFetch<RoleDashboard>(`/reports/dashboard${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok && result.data) {
    return { dashboard: result.data, source: 'gateway', status: result.status };
  }
  return {
    dashboard: null,
    source: scaffoldSourceFromResponse(false, result.status),
    status: result.status,
    error: result.error?.message ?? 'Failed to load dashboard',
  };
}
