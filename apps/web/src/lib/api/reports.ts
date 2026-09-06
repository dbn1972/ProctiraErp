/**
 * Report service client.
 *
 * Validates: Requirement 17.1 — report templates, configuration, and outputs.
 */
import { gatewayFetch } from './gateway';
import {
  scaffoldSourceFromResponse,
  type ScaffoldDataSource,
} from './insights-source';

export type { ScaffoldDataSource };

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  module: string;
  format: Array<'PDF' | 'XLSX' | 'CSV'>;
  filters: ReportFilter[];
}

export interface ReportFilter {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'number';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface ReportRun {
  id: string;
  templateId: string;
  templateName: string;
  generatedAt: string;
  generatedBy: string;
  format: 'PDF' | 'XLSX' | 'CSV';
  fileSizeKb: number;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  downloadUrl: string | null;
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
    return { runs: result.data?.data ?? [], source: 'gateway' };
  }
  return { runs: [], source: 'scaffold' };
}
