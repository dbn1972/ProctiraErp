/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/library/**` route is gated on library
 * access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, no title name, and no catalogue, loan, hold,
 * fine or student reads.
 *
 * The client forms and desks are stubbed: this file tests the page-level
 * check, and the components have their own tests.
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

const ITEM = {
  id: '00000000-0000-4000-8000-0000000000a1',
  title: 'The Wandering Atlas',
  author: 'R. Iyer',
  isbn: null,
  copies: 1,
  available: 1,
  copyList: [],
  holds: [],
};

const libraryApi = vi.hoisted(() => ({
  getLibraryItem: vi.fn(),
  listLibraryItems: vi.fn(),
  listLibraryItemsResult: vi.fn(),
  listLibraryFines: vi.fn(),
  listLibraryHoldsResult: vi.fn(),
  listLibraryOverduesResult: vi.fn(),
  searchLibraryOpacResult: vi.fn(),
}));
vi.mock('@/lib/api/library', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...libraryApi,
}));

const directory = vi.hoisted(() => ({
  loadStudentOptions: vi.fn(),
  loadStudentLabelMap: vi.fn(),
}));
vi.mock('@/lib/load-entity-labels', () => directory);

const writeGuard = vi.hoisted(() => ({ canWrite: vi.fn() }));
vi.mock('@/lib/auth/route-write-guard', () => writeGuard);

vi.mock('./_components/place-hold-form', () => ({ PlaceHoldForm: () => null }));
vi.mock('./_components/circulation-desk', () => ({ CirculationDesk: () => null }));
vi.mock('./_components/mark-paid-button', () => ({ MarkPaidButton: () => null }));
vi.mock('./_components/opac-search-form', () => ({ OpacSearchForm: () => null }));
vi.mock('./_components/assess-fine-button', () => ({ AssessFineButton: () => null }));
vi.mock('./_components/clearance-form', () => ({ LibraryClearanceForm: () => null }));
vi.mock('./_components/isbn-import-form', () => ({ IsbnImportForm: () => null }));
vi.mock('./_components/new-item-form', () => ({ NewLibraryItemForm: () => null }));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...libraryApi, ...directory, ...writeGuard, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  libraryApi.getLibraryItem.mockResolvedValue(ITEM);
  libraryApi.listLibraryItems.mockResolvedValue([ITEM]);
  libraryApi.listLibraryItemsResult.mockResolvedValue({ ok: true, items: [ITEM] });
  libraryApi.listLibraryFines.mockResolvedValue([]);
  libraryApi.listLibraryHoldsResult.mockResolvedValue({ ok: true, items: [] });
  libraryApi.listLibraryOverduesResult.mockResolvedValue({ ok: true, items: [] });
  libraryApi.searchLibraryOpacResult.mockResolvedValue({ ok: true, items: [ITEM] });
  directory.loadStudentOptions.mockResolvedValue([]);
  directory.loadStudentLabelMap.mockResolvedValue({});
  writeGuard.canWrite.mockResolvedValue(true);
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
  { path: '/library', file: './page.tsx' },
  { path: '/library/circulation', file: './circulation/page.tsx' },
  { path: '/library/fines', file: './fines/page.tsx' },
  { path: '/library/holds', file: './holds/page.tsx' },
  {
    path: '/library/opac',
    file: './opac/page.tsx',
    props: { searchParams: Promise.resolve({ q: 'atlas' }) },
  },
  { path: '/library/overdues', file: './overdues/page.tsx' },
  {
    path: '/library/[id]',
    file: './[id]/page.tsx',
    props: { params: Promise.resolve({ id: ITEM.id }) },
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

/** Teaching, office, platform and portal roles hold no library staff read. */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['registrar'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  ['parent'],
  [],
];

// UATENV-D20: the librarian holds the gateway `library: manage` grant.
const ALLOWED_ROLE_SETS = [['principal'], ['admin'], ['librarian']];

describe('library route guard (A-batch)', () => {
  it('covers every page under /library', () => {
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
        expect(screen.queryByText(ITEM.title)).toBeNull();
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
