/**
 * A-batch — the `/admissions` layout replaces every admissions screen with the
 * access-denied card for roles without admissions access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdmissionsLayout from './layout';

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

const child: ReactNode = <p data-testid="admissions-child">admissions screen</p>;

describe('admissions layout guard (A-batch)', () => {
  it.each([
    ['teacher'],
    ['staff'],
    ['registrar'],
    ['admissions_officer'],
    ['platform_admin'],
    ['student'],
    ['guardian'],
    ['parent'],
    [],
  ])('replaces every admissions screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await AdmissionsLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('admissions-child')).toBeNull();
  });

  it.each([['admin'], ['principal'], ['super-admin']])(
    'renders the admissions screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await AdmissionsLayout({ children: child })}</>);
      expect(screen.getByTestId('admissions-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
