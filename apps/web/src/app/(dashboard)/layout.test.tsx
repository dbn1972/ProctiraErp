/**
 * @vitest-environment jsdom
 *
 * DashboardLayout — tenant identity slot wiring (Task 11.2/11.3 / Req 1
 * AC1, AC3, AC6) and header identity wiring (Task 12.1 / Req 2 AC1, AC2,
 * AC8).
 *
 * `DashboardLayout` is an async Server Component, exercised the same way
 * other async Server Components in this repo are tested (see
 * `apps/web/src/app/(parent)/parent/sunrise-screens.test.tsx`): call it
 * directly as an async function and render the resolved element tree.
 *
 * `<AppShell>` is mocked to a thin stub so this suite stays focused on
 * `DashboardLayout`'s OWN contribution — fetching the student headcount,
 * resolving `<TenantIdentityBlock>`, and assembling `headerIdentity` —
 * rather than re-testing the viewport switch (`AppShell.test.tsx`) or the
 * sidebar's slot placement (`sidebar.test.tsx`). `TenantIdentityBlock`
 * itself is NOT mocked, so these tests exercise the real integration
 * between the layout's fetch and the block's own degradation behaviour;
 * only its transitive dependency `@/lib/api/admin.server` is mocked, same
 * as `TenantIdentityBlock.test.tsx`. The stub captures `headerIdentity` as
 * serialized text so this suite can assert its exact shape without
 * pulling in the real `<Header>` (covered by `header.test.tsx`).
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import type { HeaderIdentity } from '@/components/layout/header';
import type { TokenPayload } from '@/lib/auth/session';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function session(user: Partial<TokenPayload> = {}) {
  return {
    user: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@sunrise.test',
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: 'area-1' }],
      iat: 1,
      exp: 9_999_999_999,
      ...user,
    },
  };
}

const requireSessionMock = vi.fn(async () => session());
vi.mock('@/lib/auth/server', () => ({
  // `requireSession()` is always called with zero arguments from
  // `DashboardLayout` — no rest-spread indirection needed (and a spread
  // into a zero-arg mock signature does not typecheck).
  requireSession: () => requireSessionMock(),
}));

const listStudents = vi.fn();
vi.mock('@/lib/api/students', () => ({
  listStudents: (...args: unknown[]) => listStudents(...args),
}));

const getTenantSettings = vi.fn();
vi.mock('@/lib/api/admin.server', () => ({
  getTenantSettings: (...args: unknown[]) => getTenantSettings(...args),
}));

// Task 12.3 — the layout also resolves the header's unread-notification
// count (`getUnreadNotificationCount(session.user.sub)`, degrading to `0`
// on failure). Mocked here so this suite's assertions on `headerIdentity`'s
// shape are explicit rather than incidentally passing through the real
// module's `.catch(() => 0)` network-failure path.
const getUnreadNotificationCount = vi.fn();
vi.mock('@/lib/api/notifications-inbox', () => ({
  getUnreadNotificationCount: (...args: unknown[]) => getUnreadNotificationCount(...args),
}));

// Thin stub so this suite observes exactly what DashboardLayout hands to
// AppShell, without pulling in the real viewport-switch/sidebar/header
// machinery (each already covered by its own test file).
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({
    children,
    tenantIdentitySlot,
    headerIdentity,
  }: {
    children: React.ReactNode;
    tenantIdentitySlot?: React.ReactNode;
    headerIdentity?: HeaderIdentity;
  }) => (
    <div data-testid="app-shell-stub">
      <div data-testid="slot-stub">{tenantIdentitySlot}</div>
      <pre data-testid="header-identity-stub">{JSON.stringify(headerIdentity ?? null)}</pre>
      <div data-testid="children-stub">{children}</div>
    </div>
  ),
}));

import DashboardLayout from './layout';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  requireSessionMock.mockClear();
  requireSessionMock.mockImplementation(async () => session());
  listStudents.mockReset();
  getTenantSettings.mockReset();
  // Task 12.3: default every test to the documented degraded-to-zero shape
  // (`DashboardLayout`'s own `.catch(() => 0)`) so only tests that care
  // about the notification bell's count need to override it.
  getUnreadNotificationCount.mockReset();
  getUnreadNotificationCount.mockResolvedValue(0);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<DashboardLayout> — tenant identity slot, happy path (Req 1 AC1)', () => {
  it('resolves TenantIdentityBlock with the real display name and headcount, and still renders the page content', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 1240, totalPages: 1240 },
    });

    render(await DashboardLayout({ children: <div data-testid="page">page-content</div> }));

    expect(screen.getByTestId('tenant-identity-block')).toBeTruthy();
    expect(screen.getByText('Sunrise Public School')).toBeInTheDocument();
    expect(screen.getByText('1,240 students')).toBeInTheDocument();
    expect(screen.getByTestId('page')).toHaveTextContent('page-content');
  });
});

describe('<DashboardLayout> — degraded cases (Req 1 AC3)', () => {
  it('produces no identity content in the slot when tenant settings are unavailable, while the routed page still renders', async () => {
    getTenantSettings.mockResolvedValue({ settings: null, source: 'scaffold' });
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 500, totalPages: 500 },
    });

    render(await DashboardLayout({ children: <div data-testid="page">page-content</div> }));

    // The wrapping Server Component correctly omits the slot content —
    // TenantIdentityBlock renders nothing, not a blank placeholder.
    expect(screen.getByTestId('slot-stub')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('tenant-identity-block')).toBeNull();

    // The rest of the shell/page is unaffected by the degraded identity data.
    expect(screen.getByTestId('page')).toHaveTextContent('page-content');
  });

  it('still shows the tenant name (without a headcount line) when the student-count fetch fails independently', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });
    listStudents.mockRejectedValue(new Error('gateway unreachable'));

    render(await DashboardLayout({ children: <div data-testid="page">page-content</div> }));

    expect(screen.getByText('Sunrise Public School')).toBeInTheDocument();
    expect(screen.queryByText(/students?$/)).toBeNull();
  });

  it('still enforces the session boundary before fetching any tenant-scoped data', async () => {
    getTenantSettings.mockResolvedValue({ settings: null, source: 'scaffold' });
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 0, totalPages: 0 },
    });

    await DashboardLayout({ children: <div /> });

    expect(requireSessionMock).toHaveBeenCalledTimes(1);
  });
});

describe('<DashboardLayout> — tenant-scoping at the integration point (Req 1 AC6)', () => {
  /**
   * Tenant isolation for both `getTenantSettings()` and `listStudents()`
   * is enforced inside `gatewayFetch` (`apps/web/src/lib/api/gateway.ts`),
   * which resolves the caller's tenant from the session JWT and stamps
   * every outbound request with `X-Tenant-ID` — already covered by
   * `gateway.test.ts`'s "forwards X-Tenant-ID ... headers" case. Neither
   * client function accepts a caller-supplied tenant override.
   *
   * What THIS integration point (`DashboardLayout`) could plausibly get
   * wrong is introducing a NEW, parallel way to select a tenant (e.g.
   * reading a tenant id from a prop, query param, or explicit override)
   * that bypasses that session-derived resolution. These tests assert
   * the layout calls both functions exactly the way the already-tested
   * Students KPI card does — no extra arguments, no tenant override —
   * so tenant scoping here is inherited from the lower layer, not
   * reimplemented.
   */
  it('calls listStudents with only the pageSize filter — no tenant override introduced at this layer', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 10, totalPages: 10 },
    });

    render(await DashboardLayout({ children: <div /> }));

    expect(listStudents).toHaveBeenCalledTimes(1);
    expect(listStudents).toHaveBeenCalledWith({ pageSize: 1 });
  });

  it('calls getTenantSettings with no arguments — tenant resolution stays inside gatewayFetch, not passed in from this layer', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 10, totalPages: 10 },
    });

    render(await DashboardLayout({ children: <div /> }));

    // Task 12.1 (Req 2): the layout now calls `getTenantSettings()` a
    // second time, separately from `TenantIdentityBlock`'s own internal
    // call, to resolve the header identity's tenant name — the same
    // "accept the minor duplication rather than change an existing
    // component's prop contract" choice already documented above for
    // `listStudents`. Every call still takes no arguments — tenant
    // resolution stays inside `gatewayFetch`, never passed in from here.
    expect(getTenantSettings).toHaveBeenCalledTimes(2);
    expect(getTenantSettings).toHaveBeenCalledWith();
  });
});

describe('<DashboardLayout> — header identity assembly (Task 12.1 / Req 2 AC1, AC2, AC8)', () => {
  beforeEach(() => {
    listStudents.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, totalItems: 0, totalPages: 0 },
    });
  });

  it('assembles displayName, email, primaryRole, and tenantName from the session and tenant settings', async () => {
    requireSessionMock.mockResolvedValue(
      session({
        displayName: 'Asha Rao',
        email: 'asha.rao@sunrise.test',
        roles: [{ roleId: 'principal', roleName: 'Principal', areaId: 'area-1' }],
      }),
    );
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });

    render(await DashboardLayout({ children: <div /> }));

    const passed: HeaderIdentity = JSON.parse(
      screen.getByTestId('header-identity-stub').textContent ?? 'null',
    );
    expect(passed).toEqual({
      displayName: 'Asha Rao',
      email: 'asha.rao@sunrise.test',
      primaryRole: 'Principal',
      tenantName: 'Sunrise Public School',
      unreadNotificationCount: 0,
    });
  });

  it('falls back displayName to null (letting Header apply the email fallback) when the session has no displayName', async () => {
    requireSessionMock.mockResolvedValue(
      session({ displayName: undefined, email: 'admin@sunrise.test' }),
    );
    getTenantSettings.mockResolvedValue({ settings: null, source: 'scaffold' });

    render(await DashboardLayout({ children: <div /> }));

    const passed: HeaderIdentity = JSON.parse(
      screen.getByTestId('header-identity-stub').textContent ?? 'null',
    );
    expect(passed.displayName).toBeNull();
    expect(passed.email).toBe('admin@sunrise.test');
  });

  it('sets tenantName to null (not throwing) when tenant settings are unavailable', async () => {
    // `getTenantSettings()` is called with `throwOnError: false` internally
    // (`gatewayFetch`), so its documented degraded response is
    // `{ settings: null, source: 'scaffold' }` rather than a rejected
    // promise — the same input already exercised for the sidebar slot in
    // the "degraded cases" describe block above. This asserts the SAME
    // degraded input also degrades the header's tenantName, without
    // throwing.
    requireSessionMock.mockResolvedValue(session());
    getTenantSettings.mockResolvedValue({ settings: null, source: 'scaffold' });

    render(await DashboardLayout({ children: <div /> }));

    const passed: HeaderIdentity = JSON.parse(
      screen.getByTestId('header-identity-stub').textContent ?? 'null',
    );
    expect(passed.tenantName).toBeNull();
  });

  it('sets primaryRole to null when the session carries no role assignments', async () => {
    requireSessionMock.mockResolvedValue(session({ roles: [] }));
    getTenantSettings.mockResolvedValue({ settings: null, source: 'scaffold' });

    render(await DashboardLayout({ children: <div /> }));

    const passed: HeaderIdentity = JSON.parse(
      screen.getByTestId('header-identity-stub').textContent ?? 'null',
    );
    expect(passed.primaryRole).toBeNull();
  });

  it('never mixes another tenant into the header identity — tenantName comes only from the caller\'s own gatewayFetch-scoped getTenantSettings() call', async () => {
    requireSessionMock.mockResolvedValue(session({ tenantId: 'tenant-1' }));
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 'tenant-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });

    render(await DashboardLayout({ children: <div /> }));

    // getTenantSettings() takes no tenant argument — resolution happens
    // inside gatewayFetch from the session JWT, never from a value this
    // layer could substitute (Req 2 AC8 / Req 1 AC6's same guarantee).
    expect(getTenantSettings).toHaveBeenCalledWith();
    const passed: HeaderIdentity = JSON.parse(
      screen.getByTestId('header-identity-stub').textContent ?? 'null',
    );
    expect(passed.tenantName).toBe('Sunrise Public School');
  });
});
