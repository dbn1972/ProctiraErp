/**
 * H-D1 — the `/hostel` layout replaces every hostel screen with the
 * access-denied card for roles without hostel access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HostelLayout from './layout';

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

const child: ReactNode = <p data-testid="hostel-child">hostel screen</p>;

describe('hostel layout guard (H-D1)', () => {
  it.each([
    ['teacher'],
    ['staff'],
    ['student'],
    ['parent'],
    ['guardian'],
    ['transport_officer'],
    ['teacher', 'staff'],
    [],
  ])('replaces every hostel screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await HostelLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('hostel-child')).toBeNull();
  });

  it.each([
    ['admin'],
    ['principal'],
    ['super-admin'],
    ['warden'],
    ['hostel_manager'],
    ['registrar'],
    ['student', 'warden'],
    ['teacher', 'school_admin'],
  ])('renders the hostel screen for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await HostelLayout({ children: child })}</>);
    expect(screen.getByTestId('hostel-child')).toBeInTheDocument();
    expect(screen.queryByTestId('route-access-denied')).toBeNull();
  });
});
