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

/**
 * Institutions with profile lat/lng used when GIS features are empty.
 * GET /institutions?pageSize=… — filters client-side for coordinates.
 */
export async function listInstitutionMapMarkers(options?: {
  pageSize?: number;
}): Promise<DwGeoFeature[]> {
  const pageSize = options?.pageSize ?? 200;
  const result = await gatewayFetch<{
    data: Array<{
      id: string;
      name: string;
      latitude?: number | null;
      longitude?: number | null;
      typeId?: string;
      typeName?: string;
      customData?: Record<string, unknown> | null;
    }>;
  }>(`/institutions?pageSize=${pageSize}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });

  const rows = result.data?.data ?? [];
  return rows
    .filter(
      (row): row is typeof row & { latitude: number; longitude: number } =>
        typeof row.latitude === 'number' &&
        typeof row.longitude === 'number' &&
        Number.isFinite(row.latitude) &&
        Number.isFinite(row.longitude),
    )
    .map((row) => {
      const enrolmentRaw = row.customData?.['enrolment'] ?? row.customData?.['enrollment'];
      const enrolment =
        typeof enrolmentRaw === 'number'
          ? enrolmentRaw
          : typeof enrolmentRaw === 'string'
            ? Number(enrolmentRaw) || 0
            : 0;
      return {
        institutionId: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        type: row.typeName ?? row.typeId ?? 'Institution',
        enrolment,
      };
    });
}
