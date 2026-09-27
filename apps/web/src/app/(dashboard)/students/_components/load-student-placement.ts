/**
 * Server-side directory join for student screens.
 * Enrollment rows carry institution, grade, and class ids. Names live on the
 * institution, grade, and class resources.
 */
import {
  listInstitutionClasses,
  listInstitutionGrades,
  listInstitutions,
} from '@/lib/api/institutions';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';
import { getStudentEnrollments, type EnrollmentEntry } from '@/lib/api/students';
import { listGrades } from '@/lib/institutions/api';

import { emptyPlacementDirectories, type PlacementDirectories } from './student-placement-label';

function uniqueIds(ids: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function loadGradeRows(institutionIds: string[]): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await listGrades();
    if (rows.length > 0) {
      return rows.map((grade) => ({ id: grade.id, name: grade.name }));
    }
  } catch {
    // Tenant-wide /grades is optional; fall through to per-institution grades.
  }
  const nested = await Promise.all(institutionIds.map((id) => listInstitutionGrades(id)));
  return nested.flat().map((grade) => ({ id: grade.id, name: grade.name }));
}

export function preferActiveEnrollment(rows: EnrollmentEntry[]): EnrollmentEntry | null {
  return rows.find((row) => row.status === 'ENROLLED') ?? rows[0] ?? null;
}

export async function loadActiveEnrollments(
  studentIds: string[],
): Promise<Map<string, EnrollmentEntry | null>> {
  const pairs = await Promise.all(
    studentIds.map(async (studentId) => {
      const rows = await getStudentEnrollments(studentId);
      return [studentId, preferActiveEnrollment(rows)] as const;
    }),
  );
  return new Map(pairs);
}

export async function loadPlacementDirectories(
  institutionIds: Iterable<string | null | undefined>,
  knownInstitutions?: { id: string; name: string }[],
): Promise<PlacementDirectories> {
  const ids = uniqueIds(institutionIds);
  const directories = emptyPlacementDirectories();

  const [institutions, grades, classGroups] = await Promise.all([
    knownInstitutions
      ? Promise.resolve(knownInstitutions)
      : listInstitutions({ pageSize: MAX_API_PAGE_SIZE }),
    loadGradeRows(ids),
    Promise.all(ids.map((id) => listInstitutionClasses(id))),
  ]);

  for (const institution of institutions) {
    if (institution.name.trim()) directories.institutions.set(institution.id, institution.name);
  }
  for (const grade of grades) {
    if (grade.name.trim()) directories.grades.set(grade.id, grade.name);
  }
  for (const section of classGroups.flat()) {
    if (section.name.trim()) directories.classes.set(section.id, section.name);
  }
  return directories;
}
