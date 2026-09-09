export type DashboardRole = 'board' | 'principal' | 'teacher' | 'parent';

export interface DashboardCard {
  id: string;
  title: string;
  value: string;
  hint: string;
}

export interface RoleDashboard {
  role: DashboardRole;
  title: string;
  cards: DashboardCard[];
}

const DASHBOARDS: Record<DashboardRole, Omit<RoleDashboard, 'role'>> = {
  board: {
    title: 'Board dashboard',
    cards: [
      { id: 'board-schools', title: 'Schools', value: '—', hint: 'Institutions on this board' },
      { id: 'board-enrolment', title: 'Enrolment', value: '—', hint: 'Headcount across schools' },
      { id: 'board-fees', title: 'Fees collected', value: '—', hint: 'Succeeded payments' },
      { id: 'board-attendance', title: 'Attendance', value: '—', hint: 'Present-like share' },
    ],
  },
  principal: {
    title: 'Principal dashboard',
    cards: [
      { id: 'principal-enrolment', title: 'School enrolment', value: '—', hint: 'Active enrolments' },
      { id: 'principal-attendance', title: 'Today attendance', value: '—', hint: 'Campus present %' },
      { id: 'principal-dues', title: 'Open fee dues', value: '—', hint: 'Open + overdue invoices' },
      { id: 'principal-exams', title: 'Exam pass rate', value: '—', hint: 'Latest published results' },
    ],
  },
  teacher: {
    title: 'Teacher dashboard',
    cards: [
      { id: 'teacher-classes', title: 'My classes', value: '—', hint: 'Assigned sections' },
      { id: 'teacher-attendance', title: 'Period attendance', value: '—', hint: 'Today’s mark-up' },
      { id: 'teacher-grades', title: 'Pending grades', value: '—', hint: 'Unpublished entries' },
      { id: 'teacher-homework', title: 'Homework due', value: '—', hint: 'LMS assignments' },
    ],
  },
  parent: {
    title: 'Parent dashboard',
    cards: [
      { id: 'parent-children', title: 'Linked children', value: '—', hint: 'Active guardian links' },
      { id: 'parent-fees', title: 'Upcoming fees', value: '—', hint: 'Open invoices' },
      { id: 'parent-results', title: 'Recent results', value: '—', hint: 'Published marks' },
      { id: 'parent-attendance', title: 'Child attendance', value: '—', hint: 'This week' },
    ],
  },
};

export function buildRoleDashboard(role: DashboardRole): RoleDashboard {
  const spec = DASHBOARDS[role];
  return { role, title: spec.title, cards: spec.cards.map((c) => ({ ...c })) };
}

export function inferDashboardRole(
  roles: Array<{ roleId?: string; roleName?: string }> | undefined,
  queryRole?: string | null,
): DashboardRole {
  const requested = queryRole?.trim().toLowerCase();
  if (requested === 'board' || requested === 'principal' || requested === 'teacher' || requested === 'parent') {
    return requested;
  }
  const names = (roles ?? []).flatMap((r) =>
    [r.roleName, r.roleId].filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase()),
  );
  if (names.some((n) => n.includes('parent') || n.includes('guardian'))) return 'parent';
  if (names.some((n) => n.includes('teacher') || n === 'staff')) return 'teacher';
  if (names.some((n) => n.includes('board') || n.includes('trustee'))) return 'board';
  if (names.some((n) => n.includes('principal') || n.includes('head') || n.includes('admin'))) {
    return 'principal';
  }
  return 'principal';
}
