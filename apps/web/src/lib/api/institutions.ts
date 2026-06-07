/**
 * Lightweight institution-service API client used by student management UI.
 * Only the subset required by the student transfer flow and list filters is implemented.
 */
import { gatewayFetch } from './gateway';

export interface InstitutionSummary {
  id: string;
  code: string;
  name: string;
  status: string;
  areaId: string | null;
  parentArea?: { id: string; name: string } | null;
}

export interface AcademicPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface GradeSummary {
  id: string;
  name: string;
  level?: number | null;
}

export interface AreaNode {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  children?: AreaNode[];
}

export async function listInstitutions(
  params: { search?: string; areaId?: string; pageSize?: number } = {},
): Promise<InstitutionSummary[]> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.areaId) qs.set('areaId', params.areaId);
  qs.set('pageSize', String(params.pageSize ?? 50));
  const result = await gatewayFetch<{ data: InstitutionSummary[] }>(
    `/institutions?${qs.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}

export async function listAcademicPeriods(
  institutionId: string,
): Promise<AcademicPeriod[]> {
  const result = await gatewayFetch<{ data: AcademicPeriod[] }>(
    `/institutions/${encodeURIComponent(institutionId)}/academic-periods`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}

export async function listInstitutionGrades(
  institutionId: string,
): Promise<GradeSummary[]> {
  const result = await gatewayFetch<{ data: GradeSummary[] }>(
    `/institutions/${encodeURIComponent(institutionId)}/grades`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}

export async function listAreas(): Promise<AreaNode[]> {
  const result = await gatewayFetch<{ data: AreaNode[] }>(
    '/institutions/areas?pageSize=500',
    { method: 'GET', throwOnError: false, next: { revalidate: 60 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}
