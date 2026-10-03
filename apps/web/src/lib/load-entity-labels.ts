/**
 * Server-side helpers to resolve person/entity ids to human labels for list UIs.
 * Prefer these over truncating UUIDs as primary copy (UX_FINDINGS Wave 2 / 3).
 */
import { listInstitutions } from '@/lib/api/institutions';
import { listStaff } from '@/lib/api/staff';
import { getStudent, listStudents } from '@/lib/api/students';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';
import { formatCodeNameLabel, formatPersonLabel, type EntityLabelOption } from '@/lib/entity-label';

export async function loadInstitutionOptions(): Promise<EntityLabelOption[]> {
  const rows = await listInstitutions({ pageSize: MAX_API_PAGE_SIZE }).catch(() => []);
  return rows.map((row) => ({
    id: row.id,
    label: formatCodeNameLabel(row.code, row.name) || row.name,
    searchText: `${row.code} ${row.name}`,
  }));
}

type StudentRow = Awaited<ReturnType<typeof listStudents>>['data'][number];

/**
 * PRC-M156: pages read for picker options. The gateway caps pageSize at 100, so a
 * single page silently hid every student after the first 100.
 */
export const STUDENT_OPTION_MAX_PAGES = 50;

/**
 * PRC-M156: non-sensitive display code for a student — the admission / roll
 * number when the tenant records one. National ID is never used in labels or
 * search text (it is sensitive child identity data).
 */
export function studentDisplayCode(student: Pick<StudentRow, 'customData'>): string | null {
  const data = student.customData ?? {};
  for (const key of ['admissionNumber', 'admissionNo', 'rollNumber', 'studentCode']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function toStudentOption(student: StudentRow): EntityLabelOption {
  const code = studentDisplayCode(student);
  return {
    id: student.id,
    label: formatPersonLabel(student.firstName, student.lastName, code),
    searchText: [student.firstName, student.lastName, code].filter(Boolean).join(' '),
  };
}

export async function loadStudentOptions(): Promise<EntityLabelOption[]> {
  const rows: StudentRow[] = [];
  for (let page = 1; page <= STUDENT_OPTION_MAX_PAGES; page += 1) {
    const result = await listStudents({ page, pageSize: MAX_API_PAGE_SIZE }).catch(() => null);
    if (!result) break;
    rows.push(...(result.data ?? []));
    const totalPages = result.meta?.totalPages ?? 0;
    if ((result.data ?? []).length < MAX_API_PAGE_SIZE || page >= totalPages) break;
  }
  return rows.map(toStudentOption);
}

export async function loadStaffOptions(): Promise<EntityLabelOption[]> {
  const result = await listStaff({ pageSize: MAX_API_PAGE_SIZE }).catch(() => ({
    data: [] as Awaited<ReturnType<typeof listStaff>>['data'],
  }));
  return (result.data ?? []).map((staff) => ({
    id: staff.id,
    label: formatPersonLabel(staff.firstName, staff.lastName, staff.position),
    searchText: `${staff.firstName} ${staff.lastName} ${staff.position}`,
  }));
}

export async function loadStudentLabelMap(): Promise<Map<string, string>> {
  const options = await loadStudentOptions();
  return new Map(options.map((option) => [option.id, option.label]));
}

export async function loadStaffLabelMap(): Promise<Map<string, string>> {
  const options = await loadStaffOptions();
  return new Map(options.map((option) => [option.id, option.label]));
}

/** Resolve labels for a small set of student ids (e.g. parent-linked children). */
export async function loadStudentLabelsForIds(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const student = await getStudent(id).catch(() => null);
      if (!student) return [id, ''] as const;
      return [id, toStudentOption(student).label] as const;
    }),
  );
  return new Map(entries.filter(([, label]) => Boolean(label)));
}
