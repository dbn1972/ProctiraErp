/**
 * A-batch — the `/tenant-lifecycle` layout replaces the tenant register with
 * the access-denied card for roles without platform access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TenantLifecycleLayout from './layout';

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

const child: ReactNode = <p data-testid="tenant-lifecycle-child">tenant-lifecycle screen</p>;

describe('tenant-lifecycle layout guard (A-batch)', () => {
  it.each([['admin'], ['principal'], ['teacher'], ['staff'], ['student'], []])(
    'replaces the tenant-lifecycle screen with access denied for roles %j',
    async (...roles) => {
      auth.roles = roles;
      render(<>{await TenantLifecycleLayout({ children: child })}</>);
      expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
      expect(screen.queryByTestId('tenant-lifecycle-child')).toBeNull();
    },
  );

  it.each([['platform_admin'], ['super-admin']])(
    'renders the tenant-lifecycle screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await TenantLifecycleLayout({ children: child })}</>);
      expect(screen.getByTestId('tenant-lifecycle-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
