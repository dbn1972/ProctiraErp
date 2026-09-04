/**
 * Survey service client (server-side).
 */
import { gatewayFetch } from './gateway';

export type SurveyStatus = 'draft' | 'active' | 'closed' | 'archived';

export interface Survey {
  id: string;
  name: string;
  description: string | null;
  status: SurveyStatus;
  academicPeriodId: string | null;
  startDate: string | null;
  endDate: string | null;
  questions?: unknown[];
  createdAt: string;
  updatedAt: string;
}

function unwrapList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

export async function listSurveys(options?: { status?: SurveyStatus; search?: string }): Promise<Survey[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
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
