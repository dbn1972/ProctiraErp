/**
 * Server-side helpers to resolve person/entity ids to human labels for list UIs.
 * Prefer these over truncating UUIDs as primary copy (UX_FINDINGS Wave 2 / 3).
 */
import { listInstitutions } from '@/lib/api/institutions';
import { getStaff, listStaff } from '@/lib/api/staff';
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

/**
 * PRC-M083: first directory page plus the directory size, so pickers can say
 * when the seeded list is partial (and fall back to server-side search).
 */
export interface DirectoryPage {
  options: EntityLabelOption[];
  total: number;
}
export async function loadStudentDirectory(): Promise<DirectoryPage> {
  const result = await listStudents({ pageSize: MAX_API_PAGE_SIZE }).catch(() => null);
  const options = (result?.data ?? []).map((student) => ({
    id: student.id,
    label: formatPersonLabel(student.firstName, student.lastName, student.nationalId),
    searchText: `${student.firstName} ${student.lastName} ${student.nationalId ?? ''}`,
  }));
  return { options, total: Math.max(result?.meta?.totalItems ?? 0, options.length) };
}
export async function loadStaffDirectory(): Promise<DirectoryPage> {
  const result = await listStaff({ pageSize: MAX_API_PAGE_SIZE }).catch(() => null);
  const options = (result?.data ?? []).map((staff) => ({
    id: staff.id,
    label: formatPersonLabel(staff.firstName, staff.lastName, staff.position),
    searchText: `${staff.firstName} ${staff.lastName} ${staff.position}`,
  }));
  const meta = (result as { meta?: { totalItems?: number } } | null)?.meta;
  return { options, total: Math.max(meta?.totalItems ?? 0, options.length) };
}

/** Max per-id lookups for ids missing from the first directory page. */
const MAX_ID_LOOKUPS = 200;
const LOOKUP_CONCURRENCY = 8;

async function fillMissing(
  base: Map<string, string>,
  ids: Iterable<string | null | undefined> | undefined,
  lookup: (id: string) => Promise<string | null>,
): Promise<Map<string, string>> {
  if (!ids) return base;
  const missing = [...new Set([...ids].filter((id): id is string => Boolean(id)))]
    .filter((id) => !base.has(id))
    .slice(0, MAX_ID_LOOKUPS);
  for (let i = 0; i < missing.length; i += LOOKUP_CONCURRENCY) {
    const chunk = missing.slice(i, i + LOOKUP_CONCURRENCY);
    const labels = await Promise.all(chunk.map((id) => lookup(id).catch(() => null)));
    chunk.forEach((id, idx) => {
      const label = labels[idx];
      if (label) base.set(id, label);
    });
  }
  return base;
}

/**
 * Student id -> label. When `ids` are given, ids beyond the first directory
 * page are resolved individually (PRC-M083) instead of falling back to a
 * truncated UUID.
 */
export async function loadStudentLabelMap(
  ids?: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const options = await loadStudentOptions();
  return withStudentLabels(new Map(options.map((option) => [option.id, option.label])), ids);
}

export async function loadStaffLabelMap(
  ids?: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const options = await loadStaffOptions();
  return withStaffLabels(new Map(options.map((option) => [option.id, option.label])), ids);
}

/** Add labels for any `ids` missing from `base` via per-id student lookups. */
export function withStudentLabels(
  base: Map<string, string>,
  ids: Iterable<string | null | undefined> | undefined,
): Promise<Map<string, string>> {
  return fillMissing(base, ids, async (id) => {
    const s = await getStudent(id);
    return s ? formatPersonLabel(s.firstName, s.lastName, s.nationalId) : null;
  });
}

/** Add labels for any `ids` missing from `base` via per-id staff lookups. */
export function withStaffLabels(
  base: Map<string, string>,
  ids: Iterable<string | null | undefined> | undefined,
): Promise<Map<string, string>> {
  return fillMissing(base, ids, async (id) => {
    const s = await getStaff(id);
    return s ? formatPersonLabel(s.firstName, s.lastName, s.position) : null;
  });
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
/** Ids that may be either students or staff (e.g. message recipients). */
export function withPersonLabels(
  base: Map<string, string>,
  ids: Iterable<string | null | undefined> | undefined,
): Promise<Map<string, string>> {
  return fillMissing(base, ids, async (id) => {
    const student = await getStudent(id).catch(() => null);
    if (student) return formatPersonLabel(student.firstName, student.lastName, student.nationalId);
    const staff = await getStaff(id).catch(() => null);
    return staff ? formatPersonLabel(staff.firstName, staff.lastName, staff.position) : null;
  });
}
