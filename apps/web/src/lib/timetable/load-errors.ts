/**
 * PRC-M100 — timetable pages collect every failed read so they can show a
 * specific error (with retry) instead of rendering a failure as "empty".
 */
import type { ListResult } from '@/lib/api/list-result';
import type { TimetableLoadResult } from '@/lib/api/timetable';

export interface LoadFailure {
  /** What failed to load, e.g. "Staff". */
  what: string;
  detail: string;
}

const LIST_FAILURE_TEXT: Record<string, string> = {
  unauthenticated: 'Your session has expired. Sign in again.',
  denied: 'Your role cannot view this.',
  missing: 'Not available in this environment.',
  unavailable: 'The service did not respond.',
};

type AnyResult = TimetableLoadResult<unknown> | ListResult<unknown> | null | undefined;

export function failureOf(what: string, result: AnyResult): LoadFailure | null {
  if (!result || result.ok) return null;
  if ('error' in result) return { what, detail: result.error };
  if ('kind' in result) {
    return { what, detail: LIST_FAILURE_TEXT[result.kind] ?? 'Could not be loaded.' };
  }
  return { what, detail: 'Could not be loaded.' };
}

export function collectFailures(entries: Array<[string, AnyResult]>): LoadFailure[] {
  return entries
    .map(([what, result]) => failureOf(what, result))
    .filter((f): f is LoadFailure => f !== null);
}
