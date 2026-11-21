/**
 * H-D1 — every `/hostel/**` route is gated on hostel access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no hostel form, no student picker, and no hostel,
 * student-directory or tenant-settings reads.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const HOSTEL = {
  id: '00000000-0000-4000-8000-0000000000a1',
  tenantId: 'tenant-a',
  name: 'North Hostel',
  code: 'NH',
  address: null,
  capacity: 40,
  status: 'active',
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const hostelApi = vi.hoisted(() => ({
  listHostels: vi.fn(),
  listHostelAssignments: vi.fn(),
  listHostelLeaves: vi.fn(),
  listHostelVisitors: vi.fn(),
  listHostelBlocks: vi.fn(),
  listHostelRooms: vi.fn(),
  listHostelBeds: vi.fn(),
  listHostelMessPlans: vi.fn(),
  listHostelMessMenu: vi.fn(),
  listHostelMessSubscriptions: vi.fn(),
  listHostelGatePasses: vi.fn(),
  listHostelFeeStructures: vi.fn(),
  listHostelAttendance: vi.fn(),
}));
vi.mock('@/lib/api/hostel', () => hostelApi);

const STUDENT_NAME = 'Asha Rao';
const directory = vi.hoisted(() => ({
  loadStudentOptions: vi.fn(),
  loadStaffOptions: vi.fn(),
}));
vi.mock('@/lib/load-entity-labels', () => directory);

const tenantApi = vi.hoisted(() => ({ getTenantSettings: vi.fn() }));
vi.mock('@/lib/api/admin.server', () => tenantApi);

// Client forms import the server actions; the mess form loads the student
// directory through one of them on mount.
const opsActions = vi.hoisted(() => ({ loadStudentDirectoryAction: vi.fn() }));
vi.mock('../campus-ops-actions', () => opsActions);
vi.mock('../campus-actions', () => ({}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const allFetches = { ...hostelApi, ...directory, ...tenantApi, ...opsActions };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  hostelApi.listHostels.mockResolvedValue([HOSTEL]);
  for (const name of [
    'listHostelAssignments',
    'listHostelLeaves',
    'listHostelVisitors',
    'listHostelBlocks',
    'listHostelRooms',
    'listHostelBeds',
    'listHostelMessPlans',
    'listHostelMessMenu',
    'listHostelMessSubscriptions',
    'listHostelGatePasses',
    'listHostelFeeStructures',
    'listHostelAttendance',
  ] as const) {
    hostelApi[name].mockResolvedValue([]);
  }
  directory.loadStudentOptions.mockResolvedValue([
    { id: '00000000-0000-4000-8000-0000000000c1', label: STUDENT_NAME },
  ]);
  directory.loadStaffOptions.mockResolvedValue([]);
  tenantApi.getTenantSettings.mockResolvedValue({ settings: null, source: 'live' });
  opsActions.loadStudentDirectoryAction.mockResolvedValue([]);
}

type PageComponent = (props: never) => Promise<ReactElement>;

interface HostelRouteCase {
  path: string;
  load: () => Promise<{ default: PageComponent }>;
  props?: Record<string, unknown>;
}

const ROUTES: HostelRouteCase[] = [
  { path: '/hostel', load: () => import('./page') },
  { path: '/hostel/structure', load: () => import('./structure/page') },
  { path: '/hostel/assignments', load: () => import('./assignments/page') },
  {
    path: '/hostel/attendance',
    load: () => import('./attendance/page'),
    props: { searchParams: Promise.resolve({}) },
  },
  { path: '/hostel/fees', load: () => import('./fees/page') },
  { path: '/hostel/gate-passes', load: () => import('./gate-passes/page') },
  { path: '/hostel/leaves', load: () => import('./leaves/page') },
  { path: '/hostel/mess', load: () => import('./mess/page') },
  { path: '/hostel/visitors', load: () => import('./visitors/page') },
];

async function renderRoute(route: HostelRouteCase) {
  const { default: Page } = await route.load();
  render(await Page((route.props ?? {}) as never));
}

beforeEach(() => {
  resetFetches();
});

/**
 * Denied: portal roles, teacher/staff (the hostel package denies them), and
 * warden / hostel_* / registrar, which the hostel package allows but the
 * gateway RBAC registry does not grant `hostel` (H-D2, 403 today).
 */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['student'],
  ['parent'],
  ['guardian'],
  ['warden'],
  ['hostel_warden'],
  ['registrar'],
  [],
];
const ALLOWED_ROLE_SETS = [['admin'], ['principal'], ['super-admin']];

describe('hostel route guard (H-D1)', () => {
  describe.each(ROUTES)('$path', (route) => {
    it.each(DENIED_ROLE_SETS.map((roles) => [roles.join('+') || 'no roles', roles]))(
      'renders access denied with no hostel UI or reads for %s',
      async (_label, roles) => {
        auth.roles = roles as string[];
        await renderRoute(route);
        expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(document.querySelector('form')).toBeNull();
        expect(screen.queryByText(STUDENT_NAME)).toBeNull();
        expect(screen.queryByText(HOSTEL.name)).toBeNull();
        for (const [name, fn] of Object.entries(allFetches)) {
          expect(fn, `${name} must not be called`).not.toHaveBeenCalled();
        }
      },
    );

    it.each(ALLOWED_ROLE_SETS.map((roles) => [roles.join('+'), roles]))(
      'renders the screen for %s',
      async (_label, roles) => {
        auth.roles = roles as string[];
        await renderRoute(route);
        expect(screen.queryByTestId('route-access-denied')).toBeNull();
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      },
    );
  });

  it('keeps the hostel form for a tenant admin on /hostel', async () => {
    auth.roles = ['admin'];
    await renderRoute(ROUTES.find((r) => r.path === '/hostel')!);
    expect(document.querySelector('form')).not.toBeNull();
    expect(hostelApi.listHostels).toHaveBeenCalled();
  });

  it('keeps the student directory for a principal on /hostel/assignments', async () => {
    auth.roles = ['principal'];
    await renderRoute(ROUTES.find((r) => r.path === '/hostel/assignments')!);
    expect(directory.loadStudentOptions).toHaveBeenCalled();
    expect(hostelApi.listHostelAssignments).toHaveBeenCalled();
    expect(document.querySelector('form')).not.toBeNull();
  });
});
