/**
 * NEW-g1b_web-002 / PRC-L271: the role dashboard is derived from the session.
 * A ?role other than the session's own is ignored, and no role switcher is
 * rendered (its links could only ever reload the same dashboard).
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const getRoleDashboard = vi.fn();
vi.mock('@/lib/auth/server', () => ({ getSession: () => getSession() }));
vi.mock('@/lib/api/reports', () => ({
  getRoleDashboard: (role: string) => getRoleDashboard(role),
}));
vi.mock('@/components/insights/ScaffoldModeBanner', () => ({
  ScaffoldModeBanner: () => null,
}));
vi.mock('../_components/role-dashboard-panel', () => ({
  RoleDashboardPanel: ({ dashboard }: { dashboard: { role: string } }) => (
    <div data-testid="role-panel">{dashboard.role}</div>
  ),
}));

import ReportsDashboardPage from './page';

beforeEach(() => {
  getSession.mockReset();
  getRoleDashboard.mockReset();
  getRoleDashboard.mockImplementation(async (role: string) => ({
    dashboard: { role },
    source: 'gateway',
    status: 200,
    error: null,
  }));
});

describe('ReportsDashboardPage role clamp', () => {
  it('ignores a ?role that differs from the session role and renders no switcher', async () => {
    getSession.mockResolvedValue({ user: { roles: [{ roleId: 'teacher', roleName: 'Teacher' }] } });
    render(await ReportsDashboardPage({ searchParams: Promise.resolve({ role: 'board' }) }));
    expect(getRoleDashboard).toHaveBeenCalledWith('teacher');
    expect(screen.getByTestId('role-panel')).toHaveTextContent('teacher');
    expect(screen.queryByRole('navigation', { name: 'Dashboard roles' })).toBeNull();
    expect(
      screen.queryAllByRole('link', { name: /^(board|principal|teacher|staff|parent)$/ }),
    ).toHaveLength(0);
  });

  it('renders no switcher for a parent session either', async () => {
    getSession.mockResolvedValue({ user: { roles: [{ roleId: 'parent', roleName: 'Parent' }] } });
    render(await ReportsDashboardPage({}));
    expect(getRoleDashboard).toHaveBeenCalledWith('parent');
    expect(screen.queryByRole('navigation', { name: 'Dashboard roles' })).toBeNull();
  });
});
