import { listInstitutions } from '@/lib/api/institutions';
import { listAcademicPeriods, listGrades } from '@/lib/institutions/api';
export interface LookupOption {
  id: string;
  name: string;
}
export type AdmissionsLookupKey = 'institutions' | 'academic periods' | 'grades';
type Loaded<T> = { data: T[]; error: boolean };
/**
 * PRC-M150: a failed lookup is reported (and logged server-side) instead of being
 * collapsed into an empty option list that reads as "nothing configured".
 */
async function loadList<T>(
  label: AdmissionsLookupKey,
  load: () => Promise<T[]>,
): Promise<Loaded<T>> {
  try {
    return { data: await load(), error: false };
  } catch (error) {
    // eslint-disable-next-line no-console -- server-side diagnostic for a failed lookup read
    console.error(`[admissions] failed to load ${label}`, error);
    return { data: [], error: true };
  }
}
export async function loadAdmissionsLookups(): Promise<{
  institutions: LookupOption[];
  periods: LookupOption[];
  grades: LookupOption[];
  /** Lookups that failed to load; empty when every list loaded. */
  errors: AdmissionsLookupKey[];
}> {
  const [institutions, periods, grades] = await Promise.all([
    loadList('institutions', async () =>
      (await listInstitutions()).map((row) => ({ id: row.id, name: row.name })),
    ),
    loadList('academic periods', async () =>
      (await listAcademicPeriods()).map((row) => ({ id: row.id, name: row.name })),
    ),
    loadList('grades', async () =>
      (await listGrades()).map((row) => ({ id: row.id, name: row.name })),
    ),
  ]);
  const errors: AdmissionsLookupKey[] = [];
  if (institutions.error) errors.push('institutions');
  if (periods.error) errors.push('academic periods');
  if (grades.error) errors.push('grades');
  return {
    institutions: institutions.data,
    periods: periods.data,
    grades: grades.data,
    errors,
  };
}
