/**
 * Data warehouse service client.
 *
 * Validates: Requirement 15.1 — indicators, imports, GIS map.
 */
import { gatewayFetch } from './gateway';

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

export async function listIndicators(): Promise<DwIndicator[]> {
  const result = await gatewayFetch<{ data: DwIndicator[] }>('/data-warehouse/indicators', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listImportJobs(): Promise<DwImportJob[]> {
  const result = await gatewayFetch<{ data: DwImportJob[] }>(
    '/data-warehouse/import/jobs',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function listGeoFeatures(): Promise<DwGeoFeature[]> {
  const result = await gatewayFetch<{ data: DwGeoFeature[] }>('/data-warehouse/map/features', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}
