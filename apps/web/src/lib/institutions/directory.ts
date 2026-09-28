/**
 * Server fetch for GET /institutions/directory-context.
 * Null metrics mean the aggregate is unavailable — do not substitute numbers.
 */
import { gatewayFetch } from '@/lib/api/gateway';

import type { DirectorySchoolMetrics } from './directory-presentation';

export interface InstitutionDirectoryContext {
  organizationName: string | null;
  boardLabel: string | null;
  studentsEnrolled: number | null;
  reportingToday: number | null;
  studentsAvailable: boolean;
  staffAvailable: boolean;
  attendanceAvailable: boolean;
  schools: Record<string, DirectorySchoolMetrics>;
}

export const UNAVAILABLE_DIRECTORY: InstitutionDirectoryContext = {
  organizationName: null,
  boardLabel: null,
  studentsEnrolled: null,
  reportingToday: null,
  studentsAvailable: false,
  staffAvailable: false,
  attendanceAvailable: false,
  schools: {},
};

export async function loadInstitutionDirectory(): Promise<InstitutionDirectoryContext> {
  try {
    const result = await gatewayFetch<InstitutionDirectoryContext>('/institutions/directory-context', {
      method: 'GET',
      throwOnError: true,
      cache: 'no-store',
    });
    if (!result.ok || !result.data) return UNAVAILABLE_DIRECTORY;
    return {
      organizationName: result.data.organizationName ?? null,
      boardLabel: result.data.boardLabel ?? null,
      studentsEnrolled:
        typeof result.data.studentsEnrolled === 'number' ? result.data.studentsEnrolled : null,
      reportingToday:
        typeof result.data.reportingToday === 'number' ? result.data.reportingToday : null,
      studentsAvailable: result.data.studentsAvailable === true,
      staffAvailable: result.data.staffAvailable === true,
      attendanceAvailable: result.data.attendanceAvailable === true,
      schools: result.data.schools ?? {},
    };
  } catch {
    return UNAVAILABLE_DIRECTORY;
  }
}
