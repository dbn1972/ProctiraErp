/**
 * T-D1 — the `/transport` layout replaces every transport screen with the
 * access-denied card for roles without transport access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TransportLayout from './layout';

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

const child: ReactNode = <p data-testid="transport-child">transport screen</p>;

describe('transport layout guard (T-D1)', () => {
  it.each([['teacher'], ['staff'], ['student'], ['warden'], ['teacher', 'staff'], []])(
    'replaces every transport screen with access denied for roles %j',
    async (...roles) => {
      auth.roles = roles;
      render(<>{await TransportLayout({ children: child })}</>);
      expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
      expect(screen.queryByTestId('transport-child')).toBeNull();
    },
  );

  it.each([
    ['principal'],
    ['admin'],
    ['transport_officer'],
    ['fleet-manager'],
    ['registrar'],
    ['teacher', 'transport_officer'],
    ['staff', 'school-admin'],
  ])('renders the transport screen for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await TransportLayout({ children: child })}</>);
    expect(screen.getByTestId('transport-child')).toBeInTheDocument();
    expect(screen.queryByTestId('route-access-denied')).toBeNull();
  });
});
