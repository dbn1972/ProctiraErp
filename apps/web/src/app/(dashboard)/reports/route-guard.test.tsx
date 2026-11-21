/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/reports/**` route is gated on report
 * access. The catalogue pages (`/reports`, `/reports/new`, `/reports/schedules`,
 * `/reports/[id]/results`) need the report staff set. The role-dashboard pages
 * (`/reports/dashboard`, `/reports/dashboards`) also admit office `staff`:
 * GET /api/v1/reports/dashboard has no check beyond the gateway `report:read`
 * grant (packages/backend/report/src/catalogue-routes.ts:642).
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, no template name, no redirect, and no report,
 * schedule, dashboard or gradebook reads.
 *
 * `/reports/dashboards` only redirects; its allowed case checks the redirect
 * target. The client panels and forms are stubbed: this file tests the
 * page-level check, and the components have their own tests.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => {
  const state = { roles: [] as string[] };
  const session = () => ({
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'user@tenant-a.test',
      roles: state.roles.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
      iat: 0,
      exp: 9999999999,
    },
  });
  return { state, session };
});

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => auth.session()),
  getSession: vi.fn(async () => auth.session()),
}));

const TEMPLATE = {
  id: 'fee_dues',
  name: 'Fee dues ledger',
  description: 'Outstanding fee dues by class.',
  module: 'fees',
  format: ['CSV'],
  filters: [],
};

const reportsApi = vi.hoisted(() => ({
  getReportTemplate: vi.fn(),
  listReportRuns: vi.fn(),
  listReportTemplates: vi.fn(),
  getRoleDashboard: vi.fn(),
}));
vi.mock('@/lib/api/reports', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...reportsApi,
}));

const scheduleApi = vi.hoisted(() => ({
  listScheduleRuns: vi.fn(),
  listReportSchedules: vi.fn(),
  listScheduleTemplates: vi.fn(),
}));
vi.mock('@/lib/reports/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listReportRuns: scheduleApi.listScheduleRuns,
  listReportSchedules: scheduleApi.listReportSchedules,
  listReportTemplates: scheduleApi.listScheduleTemplates,
}));

const gradebookApi = vi.hoisted(() => ({ listGradebookBoards: vi.fn() }));
vi.mock('@/lib/api/gradebook', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...gradebookApi,
}));

vi.mock('./_components/board-summary-panel', () => ({ BoardSummaryPanel: () => null }));
vi.mock('./_components/catalogue-generate-panel', () => ({ CatalogueGeneratePanel: () => null }));
vi.mock('./_components/role-dashboard-panel', () => ({ RoleDashboardPanel: () => null }));
vi.mock('./new/report-builder-form', () => ({
  ReportBuilderForm: () => <form aria-label="Report builder" />,
}));
vi.mock('./schedules/schedule-form', () => ({
  ReportScheduleForm: () => <form aria-label="Schedule" />,
}));
vi.mock('./schedules/schedule-actions', () => ({
  RunDueButton: () => null,
  ScheduleRowActions: () => null,
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...reportsApi, ...scheduleApi, ...gradebookApi, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  reportsApi.getReportTemplate.mockResolvedValue({ template: TEMPLATE, source: 'gateway' });
  reportsApi.listReportRuns.mockResolvedValue({ runs: [], source: 'gateway' });
  reportsApi.listReportTemplates.mockResolvedValue({ templates: [TEMPLATE], source: 'gateway' });
  reportsApi.getRoleDashboard.mockResolvedValue({
    dashboard: { role: 'principal' },
    source: 'gateway',
    status: 200,
    error: null,
  });
  scheduleApi.listScheduleRuns.mockResolvedValue({ runs: [], source: 'gateway' });
  scheduleApi.listReportSchedules.mockResolvedValue({ schedules: [], source: 'gateway' });
  scheduleApi.listScheduleTemplates.mockResolvedValue({ templates: [TEMPLATE], source: 'gateway' });
  gradebookApi.listGradebookBoards.mockResolvedValue({ ok: true, data: [] });
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement | undefined> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
  /** The page only redirects; the allowed case checks the redirect target. */
  redirectsTo?: string;
  /** Which role set the page checks. */
  access: 'catalogue' | 'role-dashboard';
}

const NO_SEARCH = { searchParams: Promise.resolve({}) };

const ROUTES: RouteCase[] = [
  { path: '/reports', file: './page.tsx', access: 'catalogue' },
  {
    path: '/reports/dashboard',
    file: './dashboard/page.tsx',
    props: NO_SEARCH,
    access: 'role-dashboard',
  },
  {
    path: '/reports/dashboards',
    file: './dashboards/page.tsx',
    props: NO_SEARCH,
    redirectsTo: '/reports/dashboard',
    access: 'role-dashboard',
  },
  { path: '/reports/new', file: './new/page.tsx', props: NO_SEARCH, access: 'catalogue' },
  { path: '/reports/schedules', file: './schedules/page.tsx', access: 'catalogue' },
  {
    path: '/reports/[id]/results',
    file: './[id]/results/page.tsx',
    props: { params: Promise.resolve({ id: TEMPLATE.id }) },
    access: 'catalogue',
  },
];

async function renderRoute(route: RouteCase) {
  const { default: Page } = await PAGES[route.file]!();
  const element = await Page((route.props ?? {}) as never);
  render(element ?? <></>);
}

// Load every page module once up front: the first cold import of a page and
// its dependency graph can exceed the per-test timeout on a busy runner.
beforeAll(async () => {
  await Promise.all(Object.values(PAGES).map((load) => load()));
}, 60_000);

beforeEach(() => {
  resetFetches();
  vi.mocked(redirect).mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Registrar, admissions, HR-admin, platform and portal roles reach no reports
 * page. Office `staff` reaches only the role dashboard.
 */
const ROLE_DASHBOARD_DENIED_ROLE_SETS = [
  ['registrar'],
  ['admissions_officer'],
  ['staff_admin'],
  ['platform_admin'],
  ['guardian'],
  ['parent'],
  [],
];

const DENIED_ROLE_SETS: Record<RouteCase['access'], string[][]> = {
  catalogue: [['staff'], ...ROLE_DASHBOARD_DENIED_ROLE_SETS],
  'role-dashboard': ROLE_DASHBOARD_DENIED_ROLE_SETS,
};

const ALLOWED_ROLE_SETS: Record<RouteCase['access'], string[][]> = {
  catalogue: [['teacher'], ['principal']],
  'role-dashboard': [['teacher'], ['principal'], ['staff']],
};

describe('reports route guard (A-batch)', () => {
  it('covers every page under /reports', () => {
    expect(ROUTES.map((r) => r.file).sort()).toEqual(Object.keys(PAGES).sort());
  });

  describe.each(ROUTES)('$path', (route) => {
    it.each(DENIED_ROLE_SETS[route.access].map((roles) => [roles.join('+') || 'no roles', roles]))(
      'renders access denied with no UI or reads for %s',
      async (_label, roles) => {
        auth.state.roles = roles as string[];
        await renderRoute(route);
        expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(document.querySelector('form')).toBeNull();
        expect(screen.queryByText(TEMPLATE.name)).toBeNull();
        expect(redirect).not.toHaveBeenCalled();
        for (const [name, fn] of Object.entries(allFetches)) {
          expect(fn, `${name} must not be called`).not.toHaveBeenCalled();
        }
      },
    );

    it.each(ALLOWED_ROLE_SETS[route.access].map((roles) => [roles.join('+'), roles]))(
      'renders the screen for %s',
      async (_label, roles) => {
        auth.state.roles = roles as string[];
        await renderRoute(route);
        expect(screen.queryByTestId('route-access-denied')).toBeNull();
        if (route.redirectsTo) {
          expect(redirect).toHaveBeenCalledWith(route.redirectsTo);
        } else {
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        }
      },
    );
  });
});
