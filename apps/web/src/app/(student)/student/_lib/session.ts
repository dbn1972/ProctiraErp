import { requireSession } from '@/lib/auth/server';
import type { AcademicFetchResult } from '@/lib/api/parent-portal';

export function studentStatus(result: AcademicFetchResult<unknown>): 'ok' | 'forbidden' | 'error' {
  if (result.ok) return 'ok';
  if (result.status === 403 || result.status === 404) return 'forbidden';
  return 'error';
}

export async function requireStudentSession() {
  return requireSession();
}
