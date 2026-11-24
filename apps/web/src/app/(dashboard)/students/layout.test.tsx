/**
 * A-batch — the `/students` layout replaces every student-records screen with
 * the access-denied card for roles without student access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StudentsLayout from './layout';

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

const child: ReactNode = <p data-testid="students-child">students screen</p>;

describe('students layout guard (A-batch)', () => {
  it.each([
    ['registrar'],
    ['hr_officer'],
    ['platform_admin'],
    ['student'],
    ['guardian'],
    ['parent'],
    [],
  ])('replaces every students screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await StudentsLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('students-child')).toBeNull();
  });

  it.each([['admin'], ['principal'], ['teacher'], ['staff'], ['nurse'], ['super-admin']])(
    'renders the students screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await StudentsLayout({ children: child })}</>);
      expect(screen.getByTestId('students-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
