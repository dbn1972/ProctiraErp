/**
 * Institution Service API client (Server-only).
 *
 * Wraps the shared `gatewayFetch` helper (`@/lib/api/gateway`) with strongly
 * typed institution / academic-period / education / infrastructure endpoints.
 *
 * Resolution order for the upstream URL is owned by `gatewayFetch`:
 *   GATEWAY_URL → NEXT_PUBLIC_GATEWAY_URL → http://localhost:3000
 * Every request automatically includes the user's `Authorization` Bearer token
 * and an `X-Tenant-ID` header derived from the JWT (Requirement 4.7).
 *
 * IMPORTANT: This module imports `next/headers`. Only call it from Server
 * Components, route handlers, or Server Actions.
 */
import { gatewayFetch, GatewayError } from '@/lib/api/gateway';

import type {
  AcademicPeriod,
  AreaNode,
  CalendarEvent,
  ClassSection,
  CreateAcademicPeriodInput,
  CreateCalendarEventInput,
  CreateInstitutionInput,
  Grade,
  InfrastructureHierarchy,
  Institution,
  InstitutionListFilters,
  PaginatedResponse,
  RolloverInput,
  RolloverSummary,
  UpdateAcademicPeriodInput,
  UpdateInstitutionInput,
} from './types';
import { ApiClientError } from './types';

function unwrap<T>(
  result: { ok: boolean; data: T | null; error?: { code: string; message: string } },
  fallback?: T,
): T {
  if (!result.ok || result.data === null) {
    if (fallback !== undefined) return fallback;
    throw new ApiClientError({
      code: result.error?.code ?? 'UPSTREAM_ERROR',
      message: result.error?.message ?? 'Upstream service error',
      statusCode: 0,
    });
  }
  return result.data;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function rethrowAsApiError(error: unknown): never {
  if (error instanceof GatewayError) {
    const details = error.details as
      | { code?: string; errors?: Array<{ field: string; rule: string; message: string }> }
      | null
      | undefined;
    throw new ApiClientError({
      code: error.code,
      message: error.message,
      statusCode: error.status,
      ...(details?.errors && { errors: details.errors }),
    });
  }
  if (error instanceof ApiClientError) throw error;
  throw new ApiClientError({
    code: 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : 'Unexpected error',
    statusCode: 0,
  });
}

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

export async function listInstitutions(
  filters: InstitutionListFilters = {},
): Promise<PaginatedResponse<Institution>> {
  try {
    const result = await gatewayFetch<PaginatedResponse<Institution>>(
      `/institutions${buildQuery({
        page: filters.page,
        pageSize: filters.pageSize,
        areaId: filters.areaId,
        status: filters.status,
        search: filters.search,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
      })}`,
      { method: 'GET', throwOnError: true },
    );
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function getInstitution(id: string): Promise<Institution> {
  try {
    const result = await gatewayFetch<Institution>(`/institutions/${encodeURIComponent(id)}`, {
      method: 'GET',
      throwOnError: true,
    });
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function createInstitution(input: CreateInstitutionInput): Promise<Institution> {
  try {
    const result = await gatewayFetch<Institution>('/institutions', {
      method: 'POST',
      json: input,
      throwOnError: true,
    });
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function updateInstitution(
  id: string,
  input: UpdateInstitutionInput,
): Promise<Institution> {
  try {
    const result = await gatewayFetch<Institution>(`/institutions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      json: input,
      throwOnError: true,
    });
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function deactivateInstitution(id: string, reason: string): Promise<Institution> {
  try {
    const result = await gatewayFetch<Institution>(
      `/institutions/${encodeURIComponent(id)}/deactivate`,
      { method: 'POST', json: { reason }, throwOnError: true },
    );
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export async function listAreaTree(rootId?: string): Promise<AreaNode[]> {
  try {
    const result = await gatewayFetch<AreaNode[]>(`/areas/tree${buildQuery({ rootId })}`, {
      method: 'GET',
      throwOnError: true,
    });
    return unwrap(result, []);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Academic Periods
// ---------------------------------------------------------------------------

export async function listAcademicPeriods(): Promise<AcademicPeriod[]> {
  try {
    const result = await gatewayFetch<AcademicPeriod[]>('/academic-periods', {
      method: 'GET',
      throwOnError: true,
    });
    return unwrap(result, []);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export interface SubjectSummary {
  id: string;
  name: string;
  code: string;
}

export async function listSubjects(): Promise<SubjectSummary[]> {
  try {
    const result = await gatewayFetch<SubjectSummary[]>('/subjects', {
      method: 'GET',
      throwOnError: true,
    });
    return unwrap(result, []);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function createAcademicPeriod(
  input: CreateAcademicPeriodInput,
): Promise<AcademicPeriod> {
  try {
    const result = await gatewayFetch<AcademicPeriod>('/academic-periods', {
      method: 'POST',
      json: input,
      throwOnError: true,
    });
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function updateAcademicPeriod(
  id: string,
  input: UpdateAcademicPeriodInput,
): Promise<AcademicPeriod> {
  try {
    const result = await gatewayFetch<AcademicPeriod>(
      `/academic-periods/${encodeURIComponent(id)}`,
      { method: 'PUT', json: input, throwOnError: true },
    );
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function deleteAcademicPeriod(id: string): Promise<void> {
  try {
    await gatewayFetch<null>(`/academic-periods/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      throwOnError: true,
    });
  } catch (error) {
    rethrowAsApiError(error);
  }
}

// ---------------------------------------------------------------------------
// G-905 — Academic calendar events + rollover
// ---------------------------------------------------------------------------

export async function listCalendarEvents(periodId: string): Promise<CalendarEvent[]> {
  try {
    const result = await gatewayFetch<{ data: CalendarEvent[] }>(
      `/academic-periods/${encodeURIComponent(periodId)}/calendar`,
      { method: 'GET', throwOnError: true },
    );
    return unwrap(result, { data: [] }).data;
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function createCalendarEvent(
  periodId: string,
  input: CreateCalendarEventInput,
): Promise<CalendarEvent> {
  try {
    const result = await gatewayFetch<CalendarEvent>(
      `/academic-periods/${encodeURIComponent(periodId)}/calendar`,
      { method: 'POST', json: input, throwOnError: true },
    );
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function deleteCalendarEvent(periodId: string, eventId: string): Promise<void> {
  try {
    await gatewayFetch<null>(
      `/academic-periods/${encodeURIComponent(periodId)}/calendar/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', throwOnError: true },
    );
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function rolloverAcademicPeriod(
  sourcePeriodId: string,
  input: RolloverInput,
): Promise<RolloverSummary> {
  try {
    const result = await gatewayFetch<RolloverSummary>(
      `/academic-periods/${encodeURIComponent(sourcePeriodId)}/rollover`,
      { method: 'POST', json: input, throwOnError: true },
    );
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Education (grades, classes)
// ---------------------------------------------------------------------------

export async function listGrades(): Promise<Grade[]> {
  try {
    const result = await gatewayFetch<Grade[]>('/grades', {
      method: 'GET',
      throwOnError: true,
    });
    return unwrap(result, []);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export interface CreateGradeInput {
  name: string;
  code: string;
  order: number;
}

export async function createGrade(input: CreateGradeInput): Promise<Grade> {
  try {
    const result = await gatewayFetch<Grade>('/grades', {
      method: 'POST',
      json: input,
      throwOnError: true,
    });
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export interface CreateClassSectionInput {
  institutionId: string;
  gradeId: string;
  academicPeriodId: string;
  name: string;
  capacity?: number;
}

export async function createClassSection(input: CreateClassSectionInput): Promise<ClassSection> {
  try {
    const result = await gatewayFetch<ClassSection>('/classes', {
      method: 'POST',
      json: input,
      throwOnError: true,
    });
    return unwrap(result);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export async function listClassesByInstitution(
  institutionId: string,
  academicPeriodId?: string,
): Promise<ClassSection[]> {
  try {
    const result = await gatewayFetch<ClassSection[]>(
      `/classes${buildQuery({ institutionId, academicPeriodId })}`,
      { method: 'GET', throwOnError: true },
    );
    return unwrap(result, []);
  } catch (error) {
    rethrowAsApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export async function getInfrastructureHierarchy(
  institutionId: string,
): Promise<InfrastructureHierarchy> {
  try {
    // G-901: backend route is `/infrastructure/hierarchy/:institutionId`.
    const result = await gatewayFetch<InfrastructureHierarchy>(
      `/infrastructure/hierarchy/${encodeURIComponent(institutionId)}`,
      { method: 'GET', throwOnError: true },
    );
    return unwrap(result, { lands: [] });
  } catch (error) {
    rethrowAsApiError(error);
  }
}

export { ApiClientError };
