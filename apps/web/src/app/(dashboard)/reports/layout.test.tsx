/**
 * A-batch — the `/reports` layout replaces every reports screen with the
 * access-denied card for roles without report access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReportsLayout from './layout';

const auth = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'user@tenant-a.test',
      roles: auth.roles.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
      iat: 0,
      exp: 9999999999,
    },
  })),
}));

const child: ReactNode = <p data-testid="reports-child">reports screen</p>;

describe('reports layout guard (A-batch)', () => {
  it.each([
    ['staff'],
    ['registrar'],
    ['admissions_officer'],
    ['staff_admin'],
    ['platform_admin'],
    ['guardian'],
    ['parent'],
    [],
  ])('replaces every reports screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await ReportsLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('reports-child')).toBeNull();
  });

  it.each([['admin'], ['principal'], ['teacher'], ['super-admin']])(
    'renders the reports screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await ReportsLayout({ children: child })}</>);
      expect(screen.getByTestId('reports-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
