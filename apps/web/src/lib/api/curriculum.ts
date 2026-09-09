/**
 * Curriculum gateway client (G-923).
 *
 * Routes under `/api/v1/curriculum/*`.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface SyllabusUnit {
  id: string;
  tenantId: string;
  institutionId: string | null;
  subjectId: string;
  gradeId: string;
  academicPeriodId: string;
  code: string;
  name: string;
  sequence: number;
  planned: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LessonPlan {
  id: string;
  tenantId: string;
  unitId: string;
  title: string;
  objectives: string | null;
  plannedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningOutcome {
  id: string;
  tenantId: string;
  unitId: string | null;
  subjectId: string;
  gradeId: string | null;
  code: string;
  statement: string;
  createdAt: string;
  updatedAt: string;
}

export interface UnitCoverage {
  id: string;
  tenantId: string;
  unitId: string;
  taughtAt: string;
  taughtBy: string | null;
  timetableMeetingId: string | null;
  lmsSkillId: string | null;
  createdAt: string;
}

export interface CoverageSummary {
  subjectId: string;
  gradeId: string;
  academicPeriodId: string;
  planned: number;
  taught: number;
  percent: number;
  taughtUnitIds: string[];
}

export type CurriculumLoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

function mapError(error: unknown): { error: string; status?: number } {
  if (error instanceof GatewayError) {
    return { error: error.message, status: error.status };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: 'Unexpected curriculum API error' };
}

export async function listSyllabusUnits(filters: {
  institutionId?: string;
  subjectId?: string;
  gradeId?: string;
  academicPeriodId?: string;
}): Promise<CurriculumLoadResult<SyllabusUnit[]>> {
  try {
    const params = new URLSearchParams();
    if (filters.institutionId) params.set('institutionId', filters.institutionId);
    if (filters.subjectId) params.set('subjectId', filters.subjectId);
    if (filters.gradeId) params.set('gradeId', filters.gradeId);
    if (filters.academicPeriodId) params.set('academicPeriodId', filters.academicPeriodId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: SyllabusUnit[] }>(
      `/curriculum/units${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createSyllabusUnit(input: {
  institutionId?: string | null;
  subjectId: string;
  gradeId: string;
  academicPeriodId: string;
  code: string;
  name: string;
  sequence?: number;
  planned?: boolean;
  notes?: string;
}): Promise<SyllabusUnit> {
  const result = await gatewayFetch<SyllabusUnit>('/curriculum/units', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from syllabus unit create',
    });
  }
  return result.data;
}

export async function listLessonPlans(unitId: string): Promise<CurriculumLoadResult<LessonPlan[]>> {
  try {
    const result = await gatewayFetch<{ data: LessonPlan[] }>(
      `/curriculum/units/${unitId}/lesson-plans`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createLessonPlan(
  unitId: string,
  input: { title: string; objectives?: string; plannedDate?: string },
): Promise<LessonPlan> {
  const result = await gatewayFetch<LessonPlan>(`/curriculum/units/${unitId}/lesson-plans`, {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from lesson plan create',
    });
  }
  return result.data;
}

export async function markUnitTaught(
  unitId: string,
  input?: { timetableMeetingId?: string | null; lmsSkillId?: string | null },
): Promise<UnitCoverage> {
  const result = await gatewayFetch<UnitCoverage>(`/curriculum/units/${unitId}/mark-taught`, {
    method: 'POST',
    json: input ?? {},
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from mark-taught',
    });
  }
  return result.data;
}

export async function listLearningOutcomes(filters?: {
  subjectId?: string;
  unitId?: string;
  gradeId?: string;
}): Promise<CurriculumLoadResult<LearningOutcome[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.subjectId) params.set('subjectId', filters.subjectId);
    if (filters?.unitId) params.set('unitId', filters.unitId);
    if (filters?.gradeId) params.set('gradeId', filters.gradeId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: LearningOutcome[] }>(
      `/curriculum/outcomes${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createLearningOutcome(input: {
  unitId?: string | null;
  subjectId: string;
  gradeId?: string | null;
  code: string;
  statement: string;
}): Promise<LearningOutcome> {
  const result = await gatewayFetch<LearningOutcome>('/curriculum/outcomes', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from learning outcome create',
    });
  }
  return result.data;
}

export async function getCurriculumCoverage(filters: {
  subjectId: string;
  gradeId: string;
  academicPeriodId: string;
  institutionId?: string;
}): Promise<CurriculumLoadResult<CoverageSummary>> {
  try {
    const params = new URLSearchParams({
      subjectId: filters.subjectId,
      gradeId: filters.gradeId,
      academicPeriodId: filters.academicPeriodId,
    });
    if (filters.institutionId) params.set('institutionId', filters.institutionId);
    const result = await gatewayFetch<CoverageSummary>(`/curriculum/coverage?${params.toString()}`, {
      next: { revalidate: 0 },
    });
    if (!result.data) {
      return { ok: false, error: 'Empty coverage response', status: result.status };
    }
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}
