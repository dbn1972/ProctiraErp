/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/academic-periods/**` route is gated on
 * institution access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, and no academic-period, timetable or
 * institution reads.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const PERIOD = {
  id: '00000000-0000-4000-8000-0000000000a1',
  tenantId: 'tenant-a',
  name: '2026-27',
  code: 'AY26',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  status: 'active',
  kind: 'year',
  parentId: null,
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const institutionsApi = vi.hoisted(() => ({
  listAcademicPeriods: vi.fn(),
  listCalendarEvents: vi.fn(),
}));

vi.mock('@/lib/institutions/api', () => ({
  ...institutionsApi,
  ApiClientError: class ApiClientError extends Error {},
}));

const directoryApi = vi.hoisted(() => ({ listInstitutions: vi.fn() }));

vi.mock('@/lib/api/institutions', () => directoryApi);

const timetableApi = vi.hoisted(() => ({
  listBellSchedules: vi.fn(),
  listPeriods: vi.fn(),
}));

vi.mock('@/lib/api/timetable', () => timetableApi);

const actions = vi.hoisted(() => ({
  deleteAcademicPeriodAction: vi.fn(),
  createBellScheduleAction: vi.fn(),
  createPeriodAction: vi.fn(),
}));

vi.mock('@/lib/institutions/actions', () => actions);

vi.mock('../timetable-actions', () => actions);

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...institutionsApi, ...directoryApi, ...timetableApi, ...actions, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  institutionsApi.listAcademicPeriods.mockResolvedValue([PERIOD]);
  institutionsApi.listCalendarEvents.mockResolvedValue([]);
  directoryApi.listInstitutions.mockResolvedValue([]);
  timetableApi.listBellSchedules.mockResolvedValue({ ok: true, data: [] });
  timetableApi.listPeriods.mockResolvedValue({ ok: true, data: [] });
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
}

const ID_PARAMS = { params: Promise.resolve({ id: PERIOD.id }) };

const ROUTES: RouteCase[] = [
  { path: '/academic-periods', file: './page.tsx' },
  {
    path: '/academic-periods/[id]/bell-schedules',
    file: './[id]/bell-schedules/page.tsx',
    props: ID_PARAMS,
  },
  { path: '/academic-periods/[id]/calendar', file: './[id]/calendar/page.tsx', props: ID_PARAMS },
];

async function renderRoute(route: RouteCase) {
  const { default: Page } = await PAGES[route.file]!();
  render(await Page((route.props ?? {}) as never));
}

// Load every page module once up front: the first cold import of a page and
// its dependency graph can exceed the per-test timeout on a busy runner.
beforeAll(async () => {
  await Promise.all(Object.values(PAGES).map((load) => load()));
}, 60_000);

beforeEach(() => {
  resetFetches();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Portal, health and HR/registrar roles have no institution read. */
const DENIED_ROLE_SETS = [
  ['student'],
  ['guardian'],
  ['parent'],
  ['nurse'],
  ['hr_officer'],
  ['registrar'],
  [],
];

const ALLOWED_ROLE_SETS = [['principal'], ['teacher']];

describe('academic-periods route guard (A-batch)', () => {
  it('covers every page under /academic-periods', () => {
    expect(ROUTES.map((r) => r.file).sort()).toEqual(Object.keys(PAGES).sort());
  });

  describe.each(ROUTES)('$path', (route) => {
    it.each(DENIED_ROLE_SETS.map((roles) => [roles.join('+') || 'no roles', roles]))(
      'renders access denied with no UI or reads for %s',
      async (_label, roles) => {
        auth.roles = roles as string[];
        await renderRoute(route);
        expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(document.querySelector('form')).toBeNull();
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
});
