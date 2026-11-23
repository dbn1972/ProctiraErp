/**
 * A-batch — the `/staff` layout replaces every staff/HR screen with the
 * access-denied card for roles without staff access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StaffLayout from './layout';

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

const child: ReactNode = <p data-testid="staff-child">staff screen</p>;

describe('staff layout guard (A-batch)', () => {
  it.each([['teacher'], ['staff'], ['nurse'], ['platform_admin'], ['student'], ['guardian'], []])(
    'replaces every staff screen with access denied for roles %j',
    async (...roles) => {
      auth.roles = roles;
      render(<>{await StaffLayout({ children: child })}</>);
      expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
      expect(screen.queryByTestId('staff-child')).toBeNull();
    },
  );

  it.each([
    ['admin'],
    ['principal'],
    ['super-admin'],
    ['hr_officer'],
    ['staff_admin'],
    ['registrar'],
    ['admissions_officer'],
  ])('renders the staff screen for %s', async (role) => {
    auth.roles = [role];
    render(<>{await StaffLayout({ children: child })}</>);
    expect(screen.getByTestId('staff-child')).toBeInTheDocument();
    expect(screen.queryByTestId('route-access-denied')).toBeNull();
  });
});
