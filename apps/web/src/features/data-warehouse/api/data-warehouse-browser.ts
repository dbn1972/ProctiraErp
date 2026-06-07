/**
 * Data warehouse IUS browser API client (Task 60A.5).
 *
 * Wires the frontend IUS browser to the data-warehouse backend service
 * via `browserGatewayFetch`. Covers indicator listing, IUS combination
 * queries, and data queries with area/time filters.
 *
 * Validates: Requirements 15.1, 15.3, 15.4, 15.5
 */

import {
  browserGatewayFetch,
} from '@/lib/api/browser-gateway';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Indicator {
  id: string;
  code: string;
  name: string;
  category: string;
  description?: string;
  keywords?: string[];
}

export interface Unit {
  id: string;
  name: string;
  indicatorId: string;
}

export interface Subgroup {
  id: string;
  name: string;
  dimension: string;
}

export interface IUSCombination {
  id: string;
  indicatorId: string;
  indicatorName: string;
  unitId: string;
  unitName: string;
  subgroupId: string;
  subgroupName: string;
  dataCount: number;
}

export interface TimePeriod {
  id: string;
  label: string;
  year: number;
  quarter?: number;
  month?: number;
}

export interface DataRecord {
  id: string;
  indicatorName: string;
  unitName: string;
  subgroupName: string;
  areaName: string;
  timePeriod: string;
  value: number;
  source?: string;
}

export interface DataQueryParams {
  indicatorIds?: string[];
  unitIds?: string[];
  subgroupIds?: string[];
  areaIds?: string[];
  timePeriodIds?: string[];
  aggregation?: 'sum' | 'avg' | 'count';
  page?: number;
  pageSize?: number;
}

export interface DataQueryResult {
  data: DataRecord[];
  total: number;
  page: number;
  pageSize: number;
  aggregation?: { type: string; value: number } | null;
}

export interface GISLayer {
  id: string;
  name: string;
  layerType: 'shapefile' | 'geojson';
  areaId: string;
  areaName: string;
  featureCount: number;
}

export interface GISFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
}

export interface GISFeatureCollection {
  type: 'FeatureCollection';
  features: GISFeature[];
}

// ─── API Functions ───────────────────────────────────────────────────────────

/**
 * Fetch all indicators with optional search/filter.
 */
export async function fetchIndicators(params?: {
  search?: string;
  category?: string;
  signal?: AbortSignal;
}): Promise<Indicator[]> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.category) searchParams.set('category', params.category);

  const query = searchParams.toString();
  const path = `/data-warehouse/indicators${query ? `?${query}` : ''}`;

  const result = await browserGatewayFetch<{ data: Indicator[] }>(path, {
    signal: params?.signal,
  });
  return result.data;
}

/**
 * Fetch indicator categories for filtering.
 */
export async function fetchIndicatorCategories(signal?: AbortSignal): Promise<string[]> {
  const result = await browserGatewayFetch<{ data: string[] }>(
    '/data-warehouse/indicators/categories',
    { signal },
  );
  return result.data;
}

/**
 * Fetch units for a given indicator.
 */
export async function fetchUnits(indicatorId: string, signal?: AbortSignal): Promise<Unit[]> {
  const result = await browserGatewayFetch<{ data: Unit[] }>(
    `/data-warehouse/indicators/${encodeURIComponent(indicatorId)}/units`,
    { signal },
  );
  return result.data;
}

/**
 * Fetch subgroups for a given indicator.
 */
export async function fetchSubgroups(indicatorId: string, signal?: AbortSignal): Promise<Subgroup[]> {
  const result = await browserGatewayFetch<{ data: Subgroup[] }>(
    `/data-warehouse/indicators/${encodeURIComponent(indicatorId)}/subgroups`,
    { signal },
  );
  return result.data;
}

/**
 * Fetch IUS combinations with optional filters.
 */
export async function fetchIUSCombinations(params?: {
  indicatorIds?: string[];
  signal?: AbortSignal;
}): Promise<IUSCombination[]> {
  const searchParams = new URLSearchParams();
  if (params?.indicatorIds?.length) {
    searchParams.set('indicatorIds', params.indicatorIds.join(','));
  }

  const query = searchParams.toString();
  const path = `/data-warehouse/ius${query ? `?${query}` : ''}`;

  const result = await browserGatewayFetch<{ data: IUSCombination[] }>(path, {
    signal: params?.signal,
  });
  return result.data;
}

/**
 * Fetch available time periods.
 */
export async function fetchTimePeriods(signal?: AbortSignal): Promise<TimePeriod[]> {
  const result = await browserGatewayFetch<{ data: TimePeriod[] }>(
    '/data-warehouse/time-periods',
    { signal },
  );
  return result.data;
}

/**
 * Query data with IUS + area + time filters.
 */
export async function queryData(
  params: DataQueryParams,
  signal?: AbortSignal,
): Promise<DataQueryResult> {
  const result = await browserGatewayFetch<DataQueryResult>(
    '/data-warehouse/query',
    {
      method: 'POST',
      json: params,
      signal,
    },
  );
  return result;
}

/**
 * Fetch available GIS layers.
 */
export async function fetchGISLayers(signal?: AbortSignal): Promise<GISLayer[]> {
  const result = await browserGatewayFetch<{ data: GISLayer[] }>(
    '/data-warehouse/gis/layers',
    { signal },
  );
  return result.data;
}

/**
 * Fetch GeoJSON features for a specific GIS layer.
 */
export async function fetchGISLayerFeatures(
  layerId: string,
  signal?: AbortSignal,
): Promise<GISFeatureCollection> {
  const result = await browserGatewayFetch<GISFeatureCollection>(
    `/data-warehouse/gis/layers/${encodeURIComponent(layerId)}/features`,
    { signal },
  );
  return result;
}

/**
 * Export data query results in the specified format.
 * Returns a download URL.
 */
export async function exportData(
  params: DataQueryParams & { format: 'xlsx' | 'csv' | 'di7' },
  signal?: AbortSignal,
): Promise<{ downloadUrl: string }> {
  const result = await browserGatewayFetch<{ downloadUrl: string }>(
    '/data-warehouse/export',
    {
      method: 'POST',
      json: params,
      signal,
    },
  );
  return result;
}
