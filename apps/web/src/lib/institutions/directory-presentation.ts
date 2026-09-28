/**
 * Presentation helpers for the institutions directory.
 * Counts stay null when the directory API has no aggregate — callers render
 * an honest empty mark instead of a placeholder number.
 */

export type AttendanceTone = 'green' | 'amber' | 'red';

/** 90%+ green, 80–89% amber, below 80% red. Matches the directory design. */
export function attendanceTone(pct: number): AttendanceTone {
  if (pct >= 90) return 'green';
  if (pct >= 80) return 'amber';
  return 'red';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Human type chip. UUID catalogue ids without a name stay blank. */
export function typeChipLabel(typeId: string, names: ReadonlyMap<string, string>): string {
  const named = names.get(typeId)?.trim();
  if (named) return named;
  if (!typeId || UUID_RE.test(typeId)) return '';
  return typeId.trim();
}

export interface DirectorySchoolMetrics {
  studentCount: number | null;
  staffCount: number | null;
  attendancePercent: number | null;
}

/** Inactive schools render em dashes for operational counts. */
export function rowMetrics(
  status: string,
  metrics: DirectorySchoolMetrics | undefined,
  availability: { students: boolean; staff: boolean } = { students: false, staff: false },
): { students: number | null; staff: number | null; attendance: number | null } {
  if (status === 'INACTIVE') {
    return { students: null, staff: null, attendance: null };
  }
  return {
    students: metrics?.studentCount ?? (availability.students ? 0 : null),
    staff: metrics?.staffCount ?? (availability.staff ? 0 : null),
    attendance: metrics?.attendancePercent ?? null,
  };
}

export function formatShowingRange(page: number, pageSize: number, totalItems: number): string {
  if (totalItems <= 0) return 'Showing 0 of 0';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return `Showing ${start}–${end} of ${totalItems}`;
}

export function formatPageLabel(page: number, totalPages: number): string {
  return `Page ${page} of ${Math.max(totalPages, 1)}`;
}

export interface TenantSwitcherCopy {
  title: string;
  /** Separate lines. Board is never concatenated onto the title. */
  lines: string[];
}

export function formatTenantSwitcher(input: {
  organizationName: string;
  boardLabel: string | null;
  studentCount: number | null;
}): TenantSwitcherCopy {
  const title = input.organizationName.trim();
  const lines: string[] = [];
  const board = input.boardLabel?.trim();
  if (board) lines.push(board);
  if (input.studentCount !== null) {
    lines.push(`${input.studentCount.toLocaleString('en-IN')} students`);
  }
  return { title, lines };
}

export function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return '•';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

const NAV_GROUPS: Record<string, string> = {
  dashboard: 'Overview',
  institutions: 'Academics',
  academicPeriods: 'Academics',
  students: 'Academics',
  admissions: 'Academics',
  staff: 'Academics',
  assessments: 'Academics',
  attendance: 'Academics',
  examinations: 'Academics',
  lms: 'Academics',
  scholarships: 'Services',
  health: 'Services',
  fees: 'Services',
  transport: 'Services',
  hostel: 'Services',
  library: 'Services',
  communication: 'Services',
  notifications: 'Services',
  parentPortal: 'Services',
  workflows: 'Insights & system',
  dataWarehouse: 'Insights & system',
  reports: 'Insights & system',
  admin: 'Insights & system',
};

export function navGroupLabel(key: string): string | null {
  return NAV_GROUPS[key] ?? null;
}

export const INSTITUTION_LIST_ERROR =
  "We couldn't load schools. Check your connection and try again.";

export function institutionListSubtitle(input: {
  filteredCount: number;
  catalogCount: number;
  filtersActive: boolean;
  failed: boolean;
}): string {
  if (input.failed) return 'Schools could not be loaded';
  if (input.filtersActive) {
    return `${input.filteredCount.toLocaleString()} of ${input.catalogCount.toLocaleString()} schools match`;
  }
  const noun = input.catalogCount === 1 ? 'school' : 'schools';
  return `${input.catalogCount.toLocaleString()} ${noun} · profiles, classes, and infrastructure`;
}
