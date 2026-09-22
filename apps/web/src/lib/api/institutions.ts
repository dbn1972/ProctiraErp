/**
 * Lightweight institution-service API client used by student management UI.
 * Only the subset required by the student transfer flow and list filters is implemented.
 */
import { gatewayFetch } from './gateway';
import { clampPageSize, MAX_API_PAGE_SIZE } from './pagination';

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

export interface ClassSectionSummary {
  id: string;
  name: string;
  gradeId: string;
  academicPeriodId: string;
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
  // Clamped: the gateway rejects pageSize > 100 with a 400, and this client
  // swallows non-ok results into [], so an over-sized request rendered as
  // 'no institutions' instead of an error.
  qs.set('pageSize', String(clampPageSize(params.pageSize)));
  const result = await gatewayFetch<{ data: InstitutionSummary[] }>(
    `/institutions?${qs.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

/**
 * Institutions with pagination metadata.
 *
 * `listInstitutions()` returns only the array, so a caller cannot tell 100 results
 * from "the first 100 of many". The dashboard KPI needs the real total: counting
 * `array.length` made the tile read exactly 100 for any tenant with more than 100
 * schools, which is a plausible-looking wrong number rather than an obvious one.
 */
export async function listInstitutionsPage(
  params: { search?: string; areaId?: string; pageSize?: number; page?: number } = {},
): Promise<{ data: InstitutionSummary[]; totalItems: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.areaId) qs.set('areaId', params.areaId);
  if (params.page) qs.set('page', String(params.page));
  qs.set('pageSize', String(clampPageSize(params.pageSize)));
  const result = await gatewayFetch<{
    data: InstitutionSummary[];
    meta?: { totalItems?: number };
  }>(`/institutions?${qs.toString()}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 30 },
  });
  const data = result.ok && result.data ? (result.data.data ?? []) : [];
  return { data, totalItems: result.data?.meta?.totalItems ?? data.length };
}

export async function listAcademicPeriods(institutionId: string): Promise<AcademicPeriod[]> {
  const result = await gatewayFetch<{ data: AcademicPeriod[] }>(
    `/institutions/${encodeURIComponent(institutionId)}/academic-periods`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function listInstitutionGrades(institutionId: string): Promise<GradeSummary[]> {
  const result = await gatewayFetch<{ data: GradeSummary[] }>(
    `/institutions/${encodeURIComponent(institutionId)}/grades`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function listInstitutionClasses(
  institutionId: string,
  academicPeriodId?: string,
): Promise<ClassSectionSummary[]> {
  const qs = new URLSearchParams({ institutionId });
  if (academicPeriodId) qs.set('academicPeriodId', academicPeriodId);
  const result = await gatewayFetch<ClassSectionSummary[] | { data: ClassSectionSummary[] }>(
    `/classes?${qs.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  if (!result.ok || !result.data) return [];
  const payload = result.data;
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

/**
 * NOTE: this endpoint does not exist.
 *
 * Area routes come from `registerAreaHierarchyRoutes` as /areas/tree, /areas/:areaId,
 * /areas/:areaId/descendants … — there is no collection `GET /areas`. The gateway
 * also mounts institutionPlugin without `areaHierarchyDb`
 * (apps/api-gateway/src/domain-plugins.ts), so those routes are not registered at
 * all and this request falls through to `GET /institutions/:id` with id='areas'.
 *
 * It therefore returns [] at any pageSize, which is why the area pickers on
 * /students/[id]/enroll and /students/[id]/transfer are permanently empty. The
 * pageSize on this call is irrelevant; the missing endpoint is the real gap.
 */
/**
 * NOTE: this endpoint does not exist, and the pageSize on it is irrelevant.
 *
 * Area routes come from `registerAreaHierarchyRoutes` as `/areas/tree`,
 * `/areas/:areaId`, `/areas/:areaId/descendants` — there is no collection
 * `GET /areas`. The gateway also mounts `institutionPlugin` without
 * `areaHierarchyDb` (`apps/api-gateway/src/domain-plugins.ts`), so those routes are
 * not registered at all and this request falls through to `GET /institutions/:id`
 * with `id='areas'`.
 *
 * It returns `[]` at any pageSize, which is why the area pickers on
 * `/students/[id]/enroll` and `/students/[id]/transfer` are permanently empty. The
 * missing endpoint is the real gap; this call site is not the fix.
 */
export async function listAreas(): Promise<AreaNode[]> {
  const result = await gatewayFetch<{ data: AreaNode[] }>(
    `/institutions/areas?pageSize=${MAX_API_PAGE_SIZE}`,
    {
      method: 'GET',
      throwOnError: false,
      next: { revalidate: 60 },
    },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}
