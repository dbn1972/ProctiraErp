/**
 * Data warehouse service client.
 *
 * Validates: Requirement 15.1 — indicators, imports, GIS map.
 */
import { gatewayFetch } from './gateway';
import type { ScaffoldDataSource } from './insights-source';

export type { ScaffoldDataSource };

export interface DwIndicator {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  latestValue: number | null;
  trend: 'UP' | 'DOWN' | 'FLAT' | null;
  lastUpdated: string | null;
}

export interface DwImportJob {
  id: string;
  source: 'EXCEL' | 'CSV' | 'DATABASE';
  filename: string;
  submittedAt: string;
  rows: number;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorMessage?: string | null;
}

export interface DwGeoFeature {
  institutionId: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  enrolment: number;
}

export async function listIndicators(): Promise<{
  indicators: DwIndicator[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: DwIndicator[] }>('/data-warehouse/indicators', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { indicators: result.data?.data ?? [], source: 'gateway' };
  }
  return { indicators: [], source: 'scaffold' };
}

export async function listImportJobs(): Promise<{
  jobs: DwImportJob[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: DwImportJob[] }>('/data-warehouse/import/jobs', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { jobs: result.data?.data ?? [], source: 'gateway' };
  }
  return { jobs: [], source: 'scaffold' };
}

export async function listGeoFeatures(): Promise<{
  features: DwGeoFeature[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: DwGeoFeature[] }>('/data-warehouse/map/features', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { features: result.data?.data ?? [], source: 'gateway' };
  }
  return { features: [], source: 'scaffold' };
}

export interface CreateImportJobInput {
  source: 'EXCEL' | 'CSV' | 'DATABASE';
  filename: string;
  rows?: number;
}

/** Live write proof — POST /data-warehouse/import/jobs. */
export async function createImportJob(input: CreateImportJobInput): Promise<{
  job: DwImportJob | null;
  source: ScaffoldDataSource;
  error?: string;
}> {
  const result = await gatewayFetch<DwImportJob>('/data-warehouse/import/jobs', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { job: result.data, source: 'gateway' };
  }
  return {
    job: null,
    source: result.status > 0 ? 'gateway' : 'scaffold',
    error: result.error?.message ?? 'Failed to create import job',
  };
}
