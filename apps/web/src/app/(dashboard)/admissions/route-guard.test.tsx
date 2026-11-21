/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/admissions/**` route is gated on
 * admissions access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, no applicant name, and no admissions,
 * institution or tenant-settings reads.
 *
 * The client panels and forms are stubbed: this file tests the page-level
 * check, and the panels have their own tests.
 */
import type { ReactElement, ReactNode } from 'react';
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

const APPLICATION = {
  id: '00000000-0000-4000-8000-0000000000a1',
  firstName: 'Asha',
  lastName: 'Rao',
  trackingNumber: 'TRK-0001',
  status: 'submitted',
  institutionId: 'inst-1',
  institutionName: 'North School',
};

const admissionsApi = vi.hoisted(() => ({
  getApplicationBundle: vi.fn(),
  listEnquiries: vi.fn(),
  getMeritList: vi.fn(),
  listApplications: vi.fn(),
  listInterviewSlots: vi.fn(),
  listWaitlist: vi.fn(),
  listSeatMatrix: vi.fn(),
}));
vi.mock('@/lib/api/admissions', () => admissionsApi);

const lookupsApi = vi.hoisted(() => ({ loadAdmissionsLookups: vi.fn() }));
vi.mock('@/lib/admissions/lookups', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...lookupsApi,
}));

const institutionsApi = vi.hoisted(() => ({ listInstitutionClasses: vi.fn() }));
vi.mock('@/lib/api/institutions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...institutionsApi,
}));

const adminApi = vi.hoisted(() => ({ getTenantSettings: vi.fn() }));
vi.mock('@/lib/api/admin.server', () => adminApi);

vi.mock('./_components/admissions-chrome', () => ({
  AdmissionsChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('./_components/admissions-nav', () => ({ AdmissionsNav: () => null }));
vi.mock('./_components/enquiry-panel', () => ({ EnquiryPanel: () => null }));
vi.mock('./_components/merit-panel', () => ({ MeritPanel: () => null }));
vi.mock('./_components/offer-panel', () => ({ OfferPanel: () => null }));
vi.mock('./_components/placement-panel', () => ({ PlacementPanel: () => null }));
vi.mock('./_components/seat-matrix-panel', () => ({ SeatMatrixPanel: () => null }));
vi.mock('./_components/status-form', () => ({ StatusForm: () => null }));
vi.mock('./_components/new-interview-slot-form', () => ({ NewInterviewSlotForm: () => null }));
vi.mock('./_components/book-interview-form', () => ({ BookInterviewForm: () => null }));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...admissionsApi, ...lookupsApi, ...institutionsApi, ...adminApi, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  admissionsApi.getApplicationBundle.mockResolvedValue({
    application: APPLICATION,
    placement: null,
  });
  admissionsApi.listEnquiries.mockResolvedValue([]);
  admissionsApi.getMeritList.mockResolvedValue({ entries: [] });
  admissionsApi.listApplications.mockResolvedValue([APPLICATION]);
  admissionsApi.listInterviewSlots.mockResolvedValue([]);
  admissionsApi.listWaitlist.mockResolvedValue([]);
  admissionsApi.listSeatMatrix.mockResolvedValue([]);
  lookupsApi.loadAdmissionsLookups.mockResolvedValue({
    institutions: [{ id: 'inst-1', name: 'North School' }],
    periods: [],
    grades: [],
    errors: [],
  });
  institutionsApi.listInstitutionClasses.mockResolvedValue([]);
  adminApi.getTenantSettings.mockResolvedValue({ settings: null });
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
}

const ROUTES: RouteCase[] = [
  { path: '/admissions', file: './page.tsx' },
  { path: '/admissions/enquiries', file: './enquiries/page.tsx' },
  {
    path: '/admissions/merit',
    file: './merit/page.tsx',
    props: { searchParams: Promise.resolve({}) },
  },
  {
    path: '/admissions/seat-matrix',
    file: './seat-matrix/page.tsx',
    props: { searchParams: Promise.resolve({}) },
  },
  {
    path: '/admissions/[id]',
    file: './[id]/page.tsx',
    props: { params: Promise.resolve({ id: APPLICATION.id }) },
  },
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

/**
 * Teaching, office and portal roles, and admissions officers (gateway grant but
 * no backend registration staff role), hold no admissions read.
 */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['registrar'],
  ['admissions_officer'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  ['parent'],
  [],
];

const ALLOWED_ROLE_SETS = [['admin'], ['principal']];

describe('admissions route guard (A-batch)', () => {
  it('covers every page under /admissions', () => {
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
        expect(screen.queryByText(/Asha/)).toBeNull();
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
