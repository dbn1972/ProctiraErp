/**
 * A-batch — the `/fees` layout replaces every fees screen with the
 * access-denied card for roles without fees access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FeesLayout from './layout';

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

const child: ReactNode = <p data-testid="fees-child">fees screen</p>;

describe('fees layout guard (A-batch)', () => {
  it.each([
    ['teacher'],
    ['staff'],
    ['registrar'],
    ['platform_admin'],
    ['student'],
    ['guardian'],
    ['parent'],
    ['teacher', 'bursar'],
    [],
  ])('replaces every fees screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await FeesLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('fees-child')).toBeNull();
  });

  it.each([['admin'], ['principal'], ['super-admin'], ['teacher', 'principal']])(
    'renders the fees screen for roles %j',
    async (...roles) => {
      auth.roles = roles;
      render(<>{await FeesLayout({ children: child })}</>);
      expect(screen.getByTestId('fees-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
