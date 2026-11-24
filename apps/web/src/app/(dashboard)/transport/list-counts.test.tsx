/**
 * T-D2 — transport list screens state the gateway's total, not the rows read.
 *
 * Before the fix the routes, vehicles and assignments screens printed
 * `rows.length` of a single 20-row page. Now they read every page and print the
 * total; when fewer rows were read than exist (a later page failed, or the
 * page cap was hit) they say "Showing N of M".
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'user@tenant-a.test',
      roles: [{ roleId: 'principal', roleName: 'principal', areaId: 'area-1' }],
      iat: 0,
      exp: 9999999999,
    },
  })),
}));
function route(i: number) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    tenantId: 'tenant-a',
    name: `Route ${i}`,
    status: 'active',
    startLocation: 'Depot',
    endLocation: 'School',
    operatingDays: [],
    createdAt: '2026-11-01',
    updatedAt: '2026-11-01',
  };
}
function vehicle(i: number) {
  return {
    id: `00000000-0000-4000-8001-${String(i).padStart(12, '0')}`,
    tenantId: 'tenant-a',
    registrationNumber: `REG-${i}`,
    capacity: 40,
    status: 'active',
    createdAt: '2026-11-01',
    updatedAt: '2026-11-01',
  };
}
function assignment(i: number) {
  return {
    id: `00000000-0000-4000-8002-${String(i).padStart(12, '0')}`,
    vehicleId: vehicle(i).id,
    driverId: `00000000-0000-4000-8003-${String(i).padStart(12, '0')}`,
    studentId: `00000000-0000-4000-8004-${String(i).padStart(12, '0')}`,
    routeId: route(i).id,
    startDate: '2026-09-01',
    isActive: true,
  };
}
const rows = <T,>(n: number, make: (i: number) => T) =>
  Array.from({ length: n }, (_, i) => make(i));
const transportApi = vi.hoisted(() => ({
  listTransportRoutes: vi.fn(),
  listTransportRoutesWithTotal: vi.fn(),
  listTransportVehicles: vi.fn(),
  listTransportVehiclesWithTotal: vi.fn(),
  listDriverAssignments: vi.fn(),
  listDriverAssignmentsWithTotal: vi.fn(),
  listStudentAssignments: vi.fn(),
  listStudentAssignmentsWithTotal: vi.fn(),
}));
vi.mock('@/lib/api/transport', () => transportApi);
vi.mock('@/lib/transport/api', () => ({ listAllStops: vi.fn(async () => []) }));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentOptions: vi.fn(async () => []),
  loadStaffOptions: vi.fn(async () => []),
}));
vi.mock('./actions', () => ({}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
type PageComponent = () => Promise<ReactElement>;
async function renderPage(load: () => Promise<{ default: PageComponent }>) {
  const { default: Page } = await load();
  render(await Page());
}
/**
 * Serve `shown` rows of a list holding `total`. The array readers get the same
 * rows, so a screen still counting `rows.length` prints `shown`, not `total`.
 */
function serve<T>(
  arrayFn: ReturnType<typeof vi.fn>,
  countedFn: ReturnType<typeof vi.fn>,
  items: T[],
  total: number,
) {
  arrayFn.mockResolvedValue(items);
  countedFn.mockResolvedValue({ items, totalItems: total, truncated: items.length < total });
}
beforeEach(() => {
  for (const fn of Object.values(transportApi)) fn.mockReset();
  serve(transportApi.listTransportRoutes, transportApi.listTransportRoutesWithTotal, [], 0);
  serve(transportApi.listTransportVehicles, transportApi.listTransportVehiclesWithTotal, [], 0);
  serve(transportApi.listDriverAssignments, transportApi.listDriverAssignmentsWithTotal, [], 0);
  serve(transportApi.listStudentAssignments, transportApi.listStudentAssignmentsWithTotal, [], 0);
});
describe('T-D2 transport list counts', () => {
  it('/transport/routes prints the total when every row was read', async () => {
    serve(
      transportApi.listTransportRoutes,
      transportApi.listTransportRoutesWithTotal,
      rows(25, route),
      25,
    );
    await renderPage(() => import('./routes/page'));
    expect(screen.getByText('25 routes for this tenant.')).toBeInTheDocument();
    expect(screen.getAllByTestId('transport-route-row')).toHaveLength(25);
    expect(screen.getByText('Route 24')).toBeInTheDocument();
  });
  it('/transport/routes says "Showing N of M" when fewer rows were read', async () => {
    serve(
      transportApi.listTransportRoutes,
      transportApi.listTransportRoutesWithTotal,
      rows(100, route),
      130,
    );
    await renderPage(() => import('./routes/page'));
    expect(screen.getByText('Showing 100 of 130 routes for this tenant.')).toBeInTheDocument();
  });
  it('/transport/routes keeps the singular copy', async () => {
    serve(
      transportApi.listTransportRoutes,
      transportApi.listTransportRoutesWithTotal,
      rows(1, route),
      1,
    );
    await renderPage(() => import('./routes/page'));
    expect(screen.getByText('1 route for this tenant.')).toBeInTheDocument();
  });
  it('/transport/vehicles prints the total and "Showing N of M"', async () => {
    serve(
      transportApi.listTransportVehicles,
      transportApi.listTransportVehiclesWithTotal,
      rows(100, vehicle),
      101,
    );
    await renderPage(() => import('./vehicles/page'));
    expect(screen.getByText('Showing 100 of 101 vehicles.')).toBeInTheDocument();
  });
  it('/transport/assignments prints both totals and "Showing N of M"', async () => {
    serve(
      transportApi.listDriverAssignments,
      transportApi.listDriverAssignmentsWithTotal,
      rows(21, assignment),
      21,
    );
    serve(
      transportApi.listStudentAssignments,
      transportApi.listStudentAssignmentsWithTotal,
      rows(100, assignment),
      140,
    );
    await renderPage(() => import('./assignments/page'));
    expect(screen.getByText('21 assignments.')).toBeInTheDocument();
    expect(screen.getByText('Showing 100 of 140 assignments.')).toBeInTheDocument();
  });
});
