'use server';
/**
 * PRC-M110 — board rollup via the web BFF. The panel used to call
 * `/api/v1/reports/board/...` on the web origin, which has no route; this
 * Server Action calls the gateway with the session's credentials instead.
 */
import { gatewayFetch } from '@/lib/api/gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BoardSummary {
  boardId: string;
  generatedAt: string;
  schools: number;
  enrolment: number;
  attendancePercent: number | null;
  feesCollectedCents: number;
  lmsCompletionPercent: number | null;
  schoolsBreakdown: Array<{ institutionId: string; name: string; enrolment: number }>;
}

export type BoardSummaryResult =
  | { status: 'success'; summary: BoardSummary }
  | { status: 'error'; message: string };

export async function getBoardSummaryAction(boardId: string): Promise<BoardSummaryResult> {
  if (typeof boardId !== 'string' || !UUID.test(boardId)) {
    return { status: 'error', message: 'Select a valid board.' };
  }
  const result = await gatewayFetch<BoardSummary>(`/reports/board/${boardId}/summary`, {
    method: 'GET',
    throwOnError: false,
    cache: 'no-store',
  });
  if (result.ok && result.data) return { status: 'success', summary: result.data };
  if (result.status === 401) return { status: 'error', message: 'Your session has expired.' };
  if (result.status === 403) {
    return { status: 'error', message: 'Your role cannot view this board summary.' };
  }
  if (result.status === 404) return { status: 'error', message: 'Board not found.' };
  return {
    status: 'error',
    message: result.error?.message ?? `Board summary is unavailable (${result.status}).`,
  };
}
