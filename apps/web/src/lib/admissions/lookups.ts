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
    safeList(async () => (await listInstitutions()).map((row) => ({ id: row.id, name: row.name }))),
    safeList(async () =>
      (await listAcademicPeriods()).map((row) => ({ id: row.id, name: row.name })),
    ),
    safeList(async () => (await listGrades()).map((row) => ({ id: row.id, name: row.name }))),
  ]);
  return { institutions, periods, grades };
}

/**
 * PRC-M070: resolve a URL-selected lookup id against the loaded options.
 * Unknown/missing ids fall back to the first option so a page always shows
 * a valid, explicitly-reflected selection rather than silently using [0]
 * while the UI suggests otherwise.
 */
export function pickSelectedLookup(
  options: ReadonlyArray<{ id: string }>,
  raw: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && options.some((option) => option.id === value)) return value;
  return options[0]?.id;
}
