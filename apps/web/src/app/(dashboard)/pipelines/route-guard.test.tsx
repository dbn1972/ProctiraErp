/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — the `/pipelines` route is gated on ETL staff
 * access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so the page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no create form, no pipeline name, and no pipeline or
 * connection reads.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const PIPELINE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Nightly attendance export',
  source: { type: 'postgres' },
  destination: { type: 'warehouse' },
  enabled: true,
};

const etlApi = vi.hoisted(() => ({
  listPipelines: vi.fn(),
  listEtlConnections: vi.fn(),
}));
vi.mock('@/lib/api/etl', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...etlApi,
}));

vi.mock('./_components/create-pipeline-form', () => ({
  CreatePipelineForm: () => <form aria-label="Create pipeline" />,
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...etlApi, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  etlApi.listPipelines.mockResolvedValue({ ok: true, items: [PIPELINE] });
  etlApi.listEtlConnections.mockResolvedValue([{ id: 'warehouse', label: 'Warehouse' }]);
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
}

const ROUTES: RouteCase[] = [{ path: '/pipelines', file: './page.tsx' }];

async function renderRoute(route: RouteCase) {
  const { default: Page } = await PAGES[route.file]!();
  render(await Page((route.props ?? {}) as never));
}

beforeEach(() => {
  resetFetches();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Teaching, office, platform and portal roles hold no ETL staff read. */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  [],
];

const ALLOWED_ROLE_SETS = [['admin'], ['principal']];

describe('pipelines route guard (A-batch)', () => {
  it('covers every page under /pipelines', () => {
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
        expect(screen.queryByText(PIPELINE.name)).toBeNull();
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
        expect(screen.getByText(PIPELINE.name)).toBeInTheDocument();
      },
    );
  });
});
