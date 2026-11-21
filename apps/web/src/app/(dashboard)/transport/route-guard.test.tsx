/**
 * T-D1 — every `/transport/**` route is gated on transport access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no transport form, no student picker, and no
 * transport or student-directory reads.
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

const ROUTE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  tenantId: 'tenant-a',
  name: 'Route A',
  status: 'active',
  startLocation: 'Depot',
  endLocation: 'School',
  operatingDays: [],
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const transportApi = vi.hoisted(() => ({
  listTransportRoutes: vi.fn(),
  getTransportRoute: vi.fn(),
  listTransportVehicles: vi.fn(),
  listDriverAssignments: vi.fn(),
  listStudentAssignments: vi.fn(),
}));
vi.mock('@/lib/api/transport', () => transportApi);

const opsApi = vi.hoisted(() => ({
  listRouteStops: vi.fn(),
  listAllStops: vi.fn(),
  getLiveMap: vi.fn(),
  getTripAttendance: vi.fn(),
  listAlertRules: vi.fn(),
  listAlerts: vi.fn(),
  listTransportFeeStructures: vi.fn(),
  listFeeLinks: vi.fn(),
}));
vi.mock('@/lib/transport/api', () => opsApi);

const STUDENT_NAME = 'Asha Rao';
const directory = vi.hoisted(() => ({
  loadStudentOptions: vi.fn(),
  loadStaffOptions: vi.fn(),
}));
vi.mock('@/lib/load-entity-labels', () => directory);

vi.mock('./actions', () => ({}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const allFetches = { ...transportApi, ...opsApi, ...directory };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  transportApi.listTransportRoutes.mockResolvedValue([ROUTE]);
  transportApi.getTransportRoute.mockResolvedValue(ROUTE);
  transportApi.listTransportVehicles.mockResolvedValue([]);
  transportApi.listDriverAssignments.mockResolvedValue([]);
  transportApi.listStudentAssignments.mockResolvedValue([]);
  opsApi.listRouteStops.mockResolvedValue([]);
  opsApi.listAllStops.mockResolvedValue([]);
  opsApi.getLiveMap.mockResolvedValue({ vehicles: [], stops: [] });
  opsApi.getTripAttendance.mockResolvedValue(null);
  opsApi.listAlertRules.mockResolvedValue([]);
  opsApi.listAlerts.mockResolvedValue([]);
  opsApi.listTransportFeeStructures.mockResolvedValue([]);
  opsApi.listFeeLinks.mockResolvedValue([]);
  directory.loadStudentOptions.mockResolvedValue([
    { id: '00000000-0000-4000-8000-0000000000c1', label: STUDENT_NAME },
  ]);
  directory.loadStaffOptions.mockResolvedValue([]);
}

type PageComponent = (props: never) => Promise<ReactElement>;

interface TransportRouteCase {
  path: string;
  load: () => Promise<{ default: PageComponent }>;
  props?: Record<string, unknown>;
}

const ROUTES: TransportRouteCase[] = [
  { path: '/transport', load: () => import('./page') },
  { path: '/transport/routes', load: () => import('./routes/page') },
  { path: '/transport/routes/new', load: () => import('./routes/new/page') },
  {
    path: '/transport/routes/[id]/stops',
    load: () => import('./routes/[id]/stops/page'),
    props: { params: Promise.resolve({ id: ROUTE.id }) },
  },
  { path: '/transport/vehicles', load: () => import('./vehicles/page') },
  { path: '/transport/assignments', load: () => import('./assignments/page') },
  {
    path: '/transport/attendance',
    load: () => import('./attendance/page'),
    props: { searchParams: Promise.resolve({}) },
  },
  { path: '/transport/live', load: () => import('./live/page') },
  { path: '/transport/alerts', load: () => import('./alerts/page') },
  { path: '/transport/fees', load: () => import('./fees/page') },
];

async function renderRoute(route: TransportRouteCase) {
  const { default: Page } = await route.load();
  render(await Page((route.props ?? {}) as never));
}

beforeEach(() => {
  resetFetches();
});

/** Teacher / staff: no transport access (the package guard denies them); hostel staff have no transport grant. */
const DENIED_ROLE_SETS = [['teacher'], ['staff'], ['student'], ['warden'], ['teacher', 'staff'], []];
/** Admin roles, the transport package staff roles and the read-only registrar (T-O1), multi-role (MR-1). */
const ALLOWED_ROLE_SETS = [
  ['principal'],
  ['admin'],
  ['transport_officer'],
  ['fleet_manager'],
  ['transport-admin'],
  ['registrar'],
  ['teacher', 'transport_officer'],
];

describe('transport route guard (T-D1)', () => {
  describe.each(ROUTES)('$path', (route) => {
    it.each(DENIED_ROLE_SETS.map((roles) => [roles.join('+') || 'no roles', roles]))(
      'renders access denied with no transport UI or reads for %s',
      async (_label, roles) => {
        auth.roles = roles as string[];
        await renderRoute(route);
        expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(document.querySelector('form')).toBeNull();
        expect(document.querySelector('#student-id')).toBeNull();
        expect(screen.queryByText(STUDENT_NAME)).toBeNull();
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

  it('keeps the student picker for a principal on /transport/assignments', async () => {
    auth.roles = ['principal'];
    await renderRoute(ROUTES.find((r) => r.path === '/transport/assignments')!);
    expect(document.querySelector('#student-id')).not.toBeNull();
    expect(directory.loadStudentOptions).toHaveBeenCalled();
    expect(screen.getByTestId('transport-student-assignment-form')).toBeInTheDocument();
  });

  it.each([['transport_officer'], ['registrar']])(
    'keeps the vehicle form and vehicle list for %s on /transport/vehicles',
    async (role) => {
      auth.roles = [role];
      await renderRoute(ROUTES.find((r) => r.path === '/transport/vehicles')!);
      expect(screen.getByTestId('transport-vehicle-form')).toBeInTheDocument();
      expect(transportApi.listTransportVehicles).toHaveBeenCalled();
    },
  );

  it('keeps the vehicle form for a tenant admin on /transport/vehicles', async () => {
    auth.roles = ['admin'];
    await renderRoute(ROUTES.find((r) => r.path === '/transport/vehicles')!);
    expect(screen.getByTestId('transport-vehicle-form')).toBeInTheDocument();
    expect(transportApi.listTransportVehicles).toHaveBeenCalled();
  });
});
