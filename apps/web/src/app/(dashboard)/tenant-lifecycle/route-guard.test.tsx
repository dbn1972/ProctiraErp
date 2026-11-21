/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — `/tenant-lifecycle` is gated on platform access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so the page must check
 * access itself, before it fetches anything. A tenant role gets the
 * access-denied card and no platform tenant read.
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

const TENANT_NAME = 'Tenant A School';

const platformApi = vi.hoisted(() => ({ listTenants: vi.fn() }));

vi.mock('@/lib/api/platform.server', () => platformApi);

// DocumentTitle reads the brand provider, which this unit render does not mount.
vi.mock('@/components/DocumentTitle', () => ({ DocumentTitle: () => null }));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...platformApi, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  platformApi.listTenants.mockResolvedValue({
    data: [
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        name: TENANT_NAME,
        slug: 'tenant-a',
        status: 'active',
        region: 'in',
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
      },
    ],
    meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    source: 'live',
    access: 'ok',
  });
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
  {
    path: '/tenant-lifecycle',
    file: './page.tsx',
    props: { searchParams: Promise.resolve({}) },
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

/** Tenant roles, including tenant admins, have no platform access. */
const DENIED_ROLE_SETS = [['admin'], ['principal'], ['teacher'], ['staff'], ['student'], []];

const ALLOWED_ROLE_SETS = [['platform_admin'], ['super-admin']];

describe('tenant-lifecycle route guard (A-batch)', () => {
  it('covers every page under /tenant-lifecycle', () => {
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
        expect(screen.queryByText(TENANT_NAME)).toBeNull();
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
