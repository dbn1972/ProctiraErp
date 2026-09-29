/**
 * Dashboard home — Students KPI card subtext wiring (Task 13.2 / Req 3.1-3.5).
 *
 * Minimal coverage of this task's own wiring only — the dedicated subtext
 * test suite is Task 13.3. Mirrors the mocking approach already used in
 * `approvals-category-badge.test.tsx` for this same non-exported
 * `DashboardPage()` Server Component.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const ACTIVE_PERIOD = {
  id: 'p1',
  tenantId: 't1',
  name: 'Term 2',
  code: 'T2',
  startDate: '2026-01-01',
  endDate: '2026-04-30',
  status: 'active' as const,
  kind: 'term' as const,
  parentId: null,
  createdAt: '2025-12-01T00:00:00.000Z',
  updatedAt: '2025-12-01T00:00:00.000Z',
};

function cardFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('a');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

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
  listInstitutionsPage.mockResolvedValue({ data: [], totalItems: 12 });
  listStaff.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 1, totalItems: 40, totalPages: 1 },
  });
  listPendingApprovals.mockResolvedValue([]);
  getRoleDashboard.mockResolvedValue({ dashboard: null, source: 'scaffold', status: 503 });
});

describe('<DashboardPage> Students KPI subtext', () => {
  it('shows "N new this term" sourced from a createdAfter/createdBefore-filtered count when a period is active', async () => {
    listAcademicPeriods.mockResolvedValue([ACTIVE_PERIOD]);
    listStudents.mockImplementation((filters: { createdAfter?: string } = {}) => {
      if (filters.createdAfter) {
        return Promise.resolve({
          data: [],
          meta: { page: 1, pageSize: 1, totalItems: 38, totalPages: 1 },
        });
      }
      return Promise.resolve({
        data: [],
        meta: { page: 1, pageSize: 1, totalItems: 240, totalPages: 1 },
      });
    });

    render(await DashboardPage());

    const studentsCard = cardFor('Students');
    expect(within(studentsCard).getByText('240')).toBeInTheDocument();
    expect(within(studentsCard).getByText('38 new this term')).toBeInTheDocument();

    // The narrow date-range filter, not a full-roster fetch, backs the count.
    expect(listStudents).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 1,
        createdAfter: ACTIVE_PERIOD.startDate,
        createdBefore: ACTIVE_PERIOD.endDate,
      }),
    );
  });

  it('omits the subtext (no error) when there is no active academic period', async () => {
    listAcademicPeriods.mockResolvedValue([]);
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 240, totalPages: 1 },
    });

    render(await DashboardPage());

    const studentsCard = cardFor('Students');
    expect(within(studentsCard).getByText('240')).toBeInTheDocument();
    expect(within(studentsCard).queryByText(/new this term/)).toBeNull();
    // Only the main KPI fetch runs — no second, period-scoped call.
    expect(listStudents).toHaveBeenCalledTimes(1);
  });

  it('degrades to no subtext (not an error) when the count fetch itself fails', async () => {
    listAcademicPeriods.mockResolvedValue([ACTIVE_PERIOD]);
    listStudents.mockImplementation((filters: { createdAfter?: string } = {}) => {
      if (filters.createdAfter) {
        return Promise.reject(new Error('gateway unreachable'));
      }
      return Promise.resolve({
        data: [],
        meta: { page: 1, pageSize: 1, totalItems: 240, totalPages: 1 },
      });
    });

    render(await DashboardPage());

    const studentsCard = cardFor('Students');
    expect(within(studentsCard).getByText('240')).toBeInTheDocument();
    expect(within(studentsCard).queryByText(/new this term/)).toBeNull();
  });

  it('never adds subtext to the Institutions or Staff cards', async () => {
    listAcademicPeriods.mockResolvedValue([ACTIVE_PERIOD]);
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 38, totalPages: 1 },
    });

    render(await DashboardPage());

    expect(within(cardFor('Institutions')).queryByText(/branch|campus/i)).toBeNull();
    expect(within(cardFor('Staff')).queryByText(/teaching/i)).toBeNull();
  });
});
