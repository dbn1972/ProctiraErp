/**
 * Dashboard home — approval category badges (Task 5 / Req 5 AC1, AC4, AC5).
 *
 * `ApprovalsPanel` is a non-exported local component inside
 * `apps/web/src/app/(dashboard)/page.tsx`. Following the same approach this
 * repo already uses for async Server Component pieces that aren't
 * independently exported (see `apps/web/src/app/(parent)/parent/sunrise-screens.test.tsx`,
 * which renders `await ParentFeesPage()` directly), this file renders the
 * default-exported `DashboardPage()` and asserts on the approvals list it
 * produces. Every other data source is mocked with a minimal successful
 * response so the assertions stay focused on the badge, per category:
 *
 *   - `category: 'transfer'`  -> `variant="secondary"` "Transfer" badge
 *   - `category: 'leave'`     -> `variant="outline"` "Leave" badge
 *   - `category` absent       -> `variant="outline"` "Uncategorized" badge
 *
 * This does not touch `listPendingApprovals()` or any data-fetching logic —
 * it mocks the already-fetched `WorkflowApproval[]` and checks rendering only.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowApproval } from '@/lib/api/workflows';

vi.mock('@/components/DocumentTitle', () => ({
  DocumentTitle: () => null,
}));

const getSession = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

const listInstitutionsPage = vi.fn();
vi.mock('@/lib/api/institutions', () => ({
  listInstitutionsPage: (...args: unknown[]) => listInstitutionsPage(...args),
}));

const listStudents = vi.fn();
vi.mock('@/lib/api/students', () => ({
  listStudents: (...args: unknown[]) => listStudents(...args),
}));

const listStaff = vi.fn();
vi.mock('@/lib/api/staff', () => ({
  listStaff: (...args: unknown[]) => listStaff(...args),
}));

const listAcademicPeriods = vi.fn();
vi.mock('@/lib/institutions/api', () => ({
  listAcademicPeriods: (...args: unknown[]) => listAcademicPeriods(...args),
}));

const getRoleDashboard = vi.fn();
vi.mock('@/lib/api/reports', () => ({
  getRoleDashboard: (...args: unknown[]) => getRoleDashboard(...args),
}));

const listPendingApprovals = vi.fn();
vi.mock('@/lib/api/workflows', () => ({
  listPendingApprovals: (...args: unknown[]) => listPendingApprovals(...args),
}));

import DashboardPage from './page';

/** Fields every fixture needs but that none of these tests assert on. */
const APPROVAL_BASE = {
  requestedAt: '2026-01-01T00:00:00.000Z',
  requestedBy: 'admin@tenant-a.test',
};

beforeEach(() => {
  getSession.mockReset();
  listInstitutionsPage.mockReset();
  listStudents.mockReset();
  listStaff.mockReset();
  listAcademicPeriods.mockReset();
  getRoleDashboard.mockReset();
  listPendingApprovals.mockReset();

  getSession.mockResolvedValue({
    user: { roles: [{ roleId: 'principal', roleName: 'Principal' }] },
  });
  listInstitutionsPage.mockResolvedValue({ data: [], totalItems: 3 });
  listStudents.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 1, totalItems: 240, totalPages: 1 },
  });
  listStaff.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 1, totalItems: 40, totalPages: 1 },
  });
  listAcademicPeriods.mockResolvedValue([]);
  // dashboard: null renders the ScaffoldModeBanner branch instead of
  // RoleDashboardPanel — irrelevant to this test, and keeps the fixture minimal.
  getRoleDashboard.mockResolvedValue({ dashboard: null, source: 'scaffold', status: 503 });
});

describe('<DashboardPage> approvals panel category badges', () => {
  it('renders a "Transfer" badge for a transfer-category approval', async () => {
    const approvals: WorkflowApproval[] = [
      {
        id: 'a1',
        instanceId: 'i1',
        definitionName: 'Student transfer approval',
        subjectType: 'student_transfer',
        subjectId: 's1',
        stepName: 'District approval',
        category: 'transfer',
        ...APPROVAL_BASE,
      },
    ];
    listPendingApprovals.mockResolvedValue(approvals);

    render(await DashboardPage());

    const row = screen.getByText('Student transfer approval').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Transfer')).toBeInTheDocument();
  });

  it('renders a "Leave" badge for a leave-category approval', async () => {
    const approvals: WorkflowApproval[] = [
      {
        id: 'a2',
        instanceId: 'i2',
        definitionName: 'Staff leave request',
        subjectType: 'staff_leave',
        subjectId: 's2',
        stepName: 'Manager approval',
        category: 'leave',
        ...APPROVAL_BASE,
      },
    ];
    listPendingApprovals.mockResolvedValue(approvals);

    render(await DashboardPage());

    const row = screen.getByText('Staff leave request').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Leave')).toBeInTheDocument();
  });

  it('falls back to "Uncategorized" when category is absent (Req 5 AC4)', async () => {
    const approvals: WorkflowApproval[] = [
      {
        id: 'a3',
        instanceId: 'i3',
        definitionName: 'Pre-taxonomy approval',
        subjectType: 'other',
        subjectId: 's3',
        stepName: 'Review',
        ...APPROVAL_BASE,
      },
    ];
    listPendingApprovals.mockResolvedValue(approvals);

    render(await DashboardPage());

    const row = screen.getByText('Pre-taxonomy approval').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Uncategorized')).toBeInTheDocument();
  });

  it('renders the correct badge per row when the list is mixed', async () => {
    const approvals: WorkflowApproval[] = [
      {
        id: 'a1',
        instanceId: 'i1',
        definitionName: 'Student transfer approval',
        subjectType: 'student_transfer',
        subjectId: 's1',
        stepName: 'District approval',
        category: 'transfer',
        ...APPROVAL_BASE,
      },
      {
        id: 'a2',
        instanceId: 'i2',
        definitionName: 'Staff leave request',
        subjectType: 'staff_leave',
        subjectId: 's2',
        stepName: 'Manager approval',
        category: 'leave',
        ...APPROVAL_BASE,
      },
      {
        id: 'a3',
        instanceId: 'i3',
        definitionName: 'Pre-taxonomy approval',
        subjectType: 'other',
        subjectId: 's3',
        stepName: 'Review',
        ...APPROVAL_BASE,
      },
    ];
    listPendingApprovals.mockResolvedValue(approvals);

    render(await DashboardPage());

    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });
});
