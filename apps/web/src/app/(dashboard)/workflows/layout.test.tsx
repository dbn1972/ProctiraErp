/**
 * A-batch — the `/workflows` layout replaces every workflows screen with the
 * access-denied card for roles without workflow access (PRC-L034 pattern).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkflowsLayout from './layout';

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

const child: ReactNode = <p data-testid="workflows-child">workflows screen</p>;

describe('workflows layout guard (A-batch)', () => {
  it.each([
    // UATENV-D25: the gateway workflow UI plugin refuses these.
    ['teacher'],
    ['staff'],
    ['platform_admin'],
    ['registrar'],
    ['hr_officer'],
    ['nurse'],
    ['student'],
    ['guardian'],
    ['parent'],
    [],
  ])('replaces every workflows screen with access denied for roles %j', async (...roles) => {
    auth.roles = roles;
    render(<>{await WorkflowsLayout({ children: child })}</>);
    expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-child')).toBeNull();
  });

  it.each([['admin'], ['principal'], ['super-admin']])(
    'renders the workflows screen for %s',
    async (role) => {
      auth.roles = [role];
      render(<>{await WorkflowsLayout({ children: child })}</>);
      expect(screen.getByTestId('workflows-child')).toBeInTheDocument();
      expect(screen.queryByTestId('route-access-denied')).toBeNull();
    },
  );
});
