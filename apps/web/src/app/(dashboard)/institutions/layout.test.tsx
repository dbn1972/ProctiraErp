/**
 * A-batch — the `/institutions` layout replaces every institutions screen
 * with the access-denied card for roles without institution access
 * (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InstitutionsLayout from './layout';

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

const child: ReactNode = <p data-testid="institutions-child">institutions screen</p>;

describe('institutions layout guard (A-batch)', () => {
  it.each([['student'], ['guardian'], ['parent'], ['nurse'], ['hr_officer'], ['registrar'], []])(
    'replaces every institutions screen with access denied for roles %j',
    async (...roles) => {
      auth.roles = roles;
      render(<>{await InstitutionsLayout({ children: child })}</>);
      expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
      expect(screen.queryByTestId('institutions-child')).toBeNull();
    },
  );

  it.each([['admin'], ['principal'], ['teacher'], ['staff'], ['super-admin'], ['platform_admin']])(
    'renders the institutions screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await InstitutionsLayout({ children: child })}</>);
      expect(screen.getByTestId('institutions-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
