/**
 * A-batch — the `/pipelines` layout replaces the ETL pipelines hub with the
 * access-denied card for roles without pipeline access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PipelinesLayout from './layout';

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

const child: ReactNode = <p data-testid="pipelines-child">pipelines screen</p>;

describe('pipelines layout guard (A-batch)', () => {
  it.each([['teacher'], ['staff'], ['platform_admin'], ['student'], ['guardian'], []])(
    'replaces every pipelines screen with access denied for roles %j',
    async (...roles) => {
      auth.roles = roles;
      render(<>{await PipelinesLayout({ children: child })}</>);
      expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
      expect(screen.queryByTestId('pipelines-child')).toBeNull();
    },
  );

  it.each([['admin'], ['principal'], ['super-admin']])(
    'renders the pipelines screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await PipelinesLayout({ children: child })}</>);
      expect(screen.getByTestId('pipelines-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
