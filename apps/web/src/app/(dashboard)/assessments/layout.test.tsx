/**
 * A-batch — the `/assessments` layout replaces every assessments screen with
 * the access-denied card for roles without assessment access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AssessmentsLayout from './layout';

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

const child: ReactNode = <p data-testid="assessments-child">assessments screen</p>;

describe('assessments layout guard (A-batch)', () => {
  it.each([
    ['staff'],
    ['registrar'],
    ['platform_admin'],
    ['student'],
    ['guardian'],
    ['parent'],
    [],
  ])('replaces every assessments screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await AssessmentsLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('assessments-child')).toBeNull();
  });

  it.each([['admin'], ['principal'], ['teacher'], ['super-admin']])(
    'renders the assessments screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await AssessmentsLayout({ children: child })}</>);
      expect(screen.getByTestId('assessments-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
