/**
 * Server-side helpers to resolve person/entity ids to human labels for list UIs.
 * Prefer these over truncating UUIDs as primary copy (UX_FINDINGS Wave 2).
 */
import { listStaff } from '@/lib/api/staff';
import { getStudent, listStudents } from '@/lib/api/students';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';
import { formatPersonLabel } from '@/lib/entity-label';

export async function loadStudentLabelMap(): Promise<Map<string, string>> {
  const result = await listStudents({ pageSize: MAX_API_PAGE_SIZE }).catch(() => ({
    data: [] as Awaited<ReturnType<typeof listStudents>>['data'],
  }));
  return new Map(
    (result.data ?? []).map((student) => [
      student.id,
      formatPersonLabel(student.firstName, student.lastName, student.nationalId),
    ]),
  );
}

export async function loadStaffLabelMap(): Promise<Map<string, string>> {
  const result = await listStaff({ pageSize: MAX_API_PAGE_SIZE }).catch(() => ({
    data: [] as Awaited<ReturnType<typeof listStaff>>['data'],
  }));
  return new Map(
    (result.data ?? []).map((staff) => [
      staff.id,
      formatPersonLabel(staff.firstName, staff.lastName, staff.position),
    ]),
  );
}

/** Resolve labels for a small set of student ids (e.g. parent-linked children). */
export async function loadStudentLabelsForIds(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const student = await getStudent(id).catch(() => null);
      if (!student) return [id, ''] as const;
      return [
        id,
        formatPersonLabel(student.firstName, student.lastName, student.nationalId),
      ] as const;
    }),
  );
  return new Map(entries.filter(([, label]) => Boolean(label)));
}
