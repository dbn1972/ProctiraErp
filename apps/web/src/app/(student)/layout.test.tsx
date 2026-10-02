/**
 * @vitest-environment jsdom
 *
 * PRC-L023 — the (student) layout gates on the student role: staff and
 * parent sessions get an accessible access-denied state, never the portal.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let roles: string[] = [];

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    accessToken: 't',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'u1',
      tenantId: 't1',
      roles: roles.map((roleId) => ({ roleId, roleName: roleId, areaId: null })),
    },
  })),
}));
vi.mock('@/components/layout/StudentPortalShell', () => ({
  StudentPortalShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="student-portal-shell">{children}</div>
  ),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import StudentLayout from './layout';

afterEach(() => cleanup());

describe('(student) layout role gate', () => {
  it('renders the portal for a student session', async () => {
    roles = ['student'];
    render(await StudentLayout({ children: <p>home</p> }));
    expect(screen.getByTestId('student-portal-shell')).toBeTruthy();
    expect(screen.getByText('home')).toBeTruthy();
  });

  it.each([[['teacher']], [['admin']], [['parent']], [[]]])(
    'denies %j without rendering portal content',
    async (sessionRoles) => {
      roles = sessionRoles;
      render(await StudentLayout({ children: <p>home</p> }));
      expect(screen.queryByTestId('student-portal-shell')).toBeNull();
      expect(screen.queryByText('home')).toBeNull();
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByTestId('route-access-denied')).toBeTruthy();
    },
  );

  it('accepts a staff member who also holds the student role', async () => {
    roles = ['staff', 'Student'];
    render(await StudentLayout({ children: <p>home</p> }));
    expect(screen.getByTestId('student-portal-shell')).toBeTruthy();
  });
});
