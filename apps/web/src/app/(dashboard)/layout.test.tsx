/**
 * @vitest-environment jsdom
 *
 * DashboardLayout — session-boundary contract.
 *
 * `DashboardLayout` (`./layout.tsx`) now delegates ALL chrome — sidebar
 * tenant identity (Requirement 1) and header identity/help/notification
 * bell (Requirement 2) — to `<Sidebar>`/`<Header>`, which are
 * self-sufficient Client Components reading `useAuth()`/`useDirectoryContext()`
 * directly rather than requiring a Server Component ancestor to resolve
 * and thread that data down as props. This layout's only remaining job
 * is the session boundary check (`requireSession()`) before rendering
 * `<AppShell>`.
 *
 * `requireSession()` redirects unauthenticated callers (via `next/navigation`'s
 * `redirect()`, which throws) rather than returning a value the layout
 * could branch on, so the meaningful behavior to assert here is simply
 * "the session check runs before the shell renders" and "the routed page
 * content passes through unchanged."
 *
 * `<AppShell>` is mocked to a thin stub so this suite stays focused on
 * `DashboardLayout`'s own contribution, rather than re-testing the
 * viewport switch (`AppShell.test.tsx`) or the sidebar/header's own
 * internals (`sidebar.keyboard.test.tsx`, `sidebar.loading.test.tsx`,
 * `header.test.tsx`).
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const requireSessionMock = vi.fn(async () => ({
  user: {
    sub: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@sunrise.test',
    roles: [{ roleId: 'principal', roleName: 'Principal', areaId: 'area-1' }],
    iat: 1,
    exp: 9_999_999_999,
  },
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell-stub">
      <div data-testid="children-stub">{children}</div>
    </div>
  ),
}));

import DashboardLayout from './layout';

beforeEach(() => {
  requireSessionMock.mockClear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<DashboardLayout> — session boundary', () => {
  it('enforces the session boundary before rendering the shell', async () => {
    render(await DashboardLayout({ children: <div data-testid="page">page-content</div> }));

    expect(requireSessionMock).toHaveBeenCalledTimes(1);
  });

  it('renders the routed page content inside AppShell', async () => {
    render(await DashboardLayout({ children: <div data-testid="page">page-content</div> }));

    expect(screen.getByTestId('app-shell-stub')).toBeTruthy();
    expect(screen.getByTestId('page')).toHaveTextContent('page-content');
  });
});
