/**
 * Survey service client (server-side).
 *
 * Wraps gateway routes under `/surveys` (CRUD, distribute, status, submit, aggregate).
 * ProctiraERP — Requirement 23.1–23.5.
 */
import { gatewayFetch } from './gateway';

/** Backend survey status enum. */
export type SurveyStatus = 'draft' | 'published' | 'closed';

export type SurveyQuestionType =
  | 'text'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'table'
  | 'repeater';

export interface SurveyQuestion {
  id?: string;
  label: string;
  type: SurveyQuestionType;
  required?: boolean;
  order: number;
  options?: Array<{ label: string; value: string }>;
}

export interface Survey {
  id: string;
  name: string;
  description: string | null;
  status: SurveyStatus;
  academicPeriodId: string | null;
  startDate: string | null;
  endDate: string | null;
  questions?: SurveyQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSurveyInput {
  name: string;
  description?: string;
  academicPeriodId?: string;
  startDate?: string;
  endDate?: string;
  questions: SurveyQuestion[];
}

export interface UpdateSurveyInput {
  name?: string;
  description?: string;
  academicPeriodId?: string;
  startDate?: string;
  endDate?: string;
  status?: SurveyStatus;
  questions?: SurveyQuestion[];
}

export interface DistributeSurveyInput {
  surveyId: string;
  filters: {
    areaIds?: string[];
    institutionTypeIds?: string[];
    classificationIds?: string[];
  };
  dueDate?: string;
  reminderDays?: number[];
}

export interface DistributionResult {
  distributed: number;
  records: Array<{
    id: string;
    surveyId: string;
    institutionId: string;
    status: string;
    dueDate: string | null;
    createdAt: string;
  }>;
}

export interface SurveyCompletionStatus {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  completionRate: number;
}

export interface SurveyAggregate {
  surveyId: string;
  totalDistributed: number;
  totalCompleted: number;
  completionRate: number;
  questionSummaries: Array<{
    questionId: string;
    questionLabel: string;
    questionType: SurveyQuestionType;
    summary: unknown;
  }>;
  crossTabulation?: Array<{
    groupKey: string;
    groupLabel: string;
    totalDistributed: number;
    totalCompleted: number;
    completionRate: number;
  }>;
}

export interface SubmitSurveyInput {
  surveyId: string;
  institutionId: string;
  answers: Array<{ questionId: string; value: unknown }>;
}

function unwrapList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

/** Normalize legacy UI status aliases to backend values. */
export function normalizeSurveyStatus(
  status: string | undefined,
): SurveyStatus | undefined {
  if (!status) return undefined;
  if (status === 'active') return 'published';
  if (status === 'archived') return 'closed';
  if (status === 'draft' || status === 'published' || status === 'closed') {
    return status;
  }
  return undefined;
}

export async function listSurveys(options?: {
  status?: SurveyStatus | 'active' | 'archived';
  search?: string;
}): Promise<Survey[]> {
  const params = new URLSearchParams();
  const status = normalizeSurveyStatus(options?.status);
  if (status) params.set('status', status);
  if (options?.search) params.set('search', options.search);
  params.set('pageSize', '100');
  const qs = params.toString();
  const result = await gatewayFetch<{ data: Survey[] } | Survey[]>(
    `/surveys${qs ? `?${qs}` : ''}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}

export async function getSurvey(id: string): Promise<Survey | null> {
  const result = await gatewayFetch<Survey>(`/surveys/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
}

export async function createSurvey(input: CreateSurveyInput): Promise<Survey> {
  const result = await gatewayFetch<Survey>('/surveys', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to create survey');
  }
  return result.data;
}

export async function updateSurvey(
  id: string,
  input: UpdateSurveyInput,
): Promise<Survey> {
  const result = await gatewayFetch<Survey>(`/surveys/${id}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to update survey');
  }
  return result.data;
}

export async function deleteSurvey(id: string): Promise<void> {
  await gatewayFetch<void>(`/surveys/${id}`, { method: 'DELETE' });
}

export async function distributeSurvey(
  input: DistributeSurveyInput,
): Promise<DistributionResult> {
  const result = await gatewayFetch<DistributionResult>('/surveys/distribute', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to distribute survey');
  }
  return result.data;
}

export async function getSurveyStatus(
  id: string,
): Promise<SurveyCompletionStatus | null> {
  const result = await gatewayFetch<SurveyCompletionStatus>(
    `/surveys/${id}/status`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data;
}

export async function sendSurveyReminders(
  id: string,
  institutionIds?: string[],
): Promise<{ reminded: number }> {
  const result = await gatewayFetch<{ remindersSent: number; reminded?: number; sent?: number }>(
    `/surveys/${id}/remind`,
    {
      method: 'POST',
      json: institutionIds ? { institutionIds } : {},
    },
  );
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to send reminders');
  }
  const reminded =
    result.data.remindersSent ??
    result.data.reminded ??
    result.data.sent ??
    0;
  return { reminded };
}

export async function submitSurvey(
  input: SubmitSurveyInput,
): Promise<{ id: string; surveyId: string; institutionId: string; submittedAt: string }> {
  const result = await gatewayFetch<{
    id: string;
    surveyId: string;
    institutionId: string;
    submittedAt: string;
  }>('/surveys/submit', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to submit survey');
  }
  return result.data;
}

export async function getSurveyAggregate(
  id: string,
  groupBy?: 'area' | 'institution_type',
): Promise<SurveyAggregate | null> {
  const params = new URLSearchParams();
  if (groupBy) params.set('groupBy', groupBy);
  const qs = params.toString();
  const result = await gatewayFetch<SurveyAggregate>(
    `/surveys/${id}/aggregate${qs ? `?${qs}` : ''}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data;
}
