import { listInstitutions } from '@/lib/api/institutions';
import { listAcademicPeriods, listGrades } from '@/lib/institutions/api';

export interface LookupOption {
  id: string;
  name: string;
}

async function safeList<T>(load: () => Promise<T[]>, fallback: T[] = []): Promise<T[]> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

export async function loadAdmissionsLookups(): Promise<{
  institutions: LookupOption[];
  periods: LookupOption[];
  grades: LookupOption[];
}> {
  const [institutions, periods, grades] = await Promise.all([
    safeList(async () =>
      (await listInstitutions()).map((row) => ({ id: row.id, name: row.name })),
    ),
    safeList(async () =>
      (await listAcademicPeriods()).map((row) => ({ id: row.id, name: row.name })),
    ),
    safeList(async () => (await listGrades()).map((row) => ({ id: row.id, name: row.name }))),
  ]);
  return { institutions, periods, grades };
}
