import { redirect } from 'next/navigation';
import { requireSession, type ServerSession } from '@/lib/auth/server';
import type { AcademicFetchResult } from '@/lib/api/parent-portal';

export type StudentFrameStatus = 'ok' | 'forbidden' | 'not-found' | 'error';

/**
 * Maps a gateway HTTP status onto the portal frame state (PRC-L023).
 * 401 means the session is no longer valid upstream, so the student is sent
 * back to sign in instead of seeing a generic error; 404 is reported as a
 * missing record, distinct from a 403 authorisation denial.
 */
export function studentStatusFromHttp(status: number | null | undefined): StudentFrameStatus {
  if (status === 401) redirect('/login?expired=true');
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  return 'error';
}

export function studentStatus(result: AcademicFetchResult<unknown>): StudentFrameStatus {
  if (result.ok) return 'ok';
  return studentStatusFromHttp(result.status);
}

export async function requireStudentSession() {
  return requireSession();
}

/**
 * PRC-L023: the student portal is for principals holding the `student` role.
 * Staff, parents and guardians are stopped at the (student) layout instead of
 * rendering self-service pages that resolve against their own (non-student)
 * identity. UX gating only — the gateway enforces on every call.
 */
export function isStudentPortalSession(session: Pick<ServerSession, 'user'>): boolean {
  return (session.user.roles ?? []).some((role) => role.roleId?.toLowerCase() === 'student');
}
