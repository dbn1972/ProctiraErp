/**
 * Report service client.
 *
 * Validates: Requirement 17.1 — report templates, configuration, and outputs.
 */
import { gatewayFetch } from './gateway';

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

export async function listReportTemplates(): Promise<ReportTemplate[]> {
  const result = await gatewayFetch<{ data: ReportTemplate[] }>('/reports/templates', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function getReportTemplate(id: string): Promise<ReportTemplate | null> {
  const result = await gatewayFetch<ReportTemplate>(`/reports/templates/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
}

export async function listReportRuns(templateId?: string): Promise<ReportRun[]> {
  const path = templateId
    ? `/reports/runs?templateId=${encodeURIComponent(templateId)}`
    : '/reports/runs';
  const result = await gatewayFetch<{ data: ReportRun[] }>(path, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}
