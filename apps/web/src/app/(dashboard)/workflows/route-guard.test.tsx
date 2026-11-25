/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/workflows/**` route is gated on
 * workflow access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no definition form, and no workflow or directory reads.
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

const DEFINITION = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Transfer approval',
  module: 'students',
  version: 1,
  steps: [],
  active: true,
  updatedAt: '2026-11-01',
};

const workflowsApi = vi.hoisted(() => ({
  listPendingApprovalsResult: vi.fn(),
  getWorkflowDefinition: vi.fn(),
  listWorkflowInstancesResult: vi.fn(),
  listWorkflowDefinitionsResult: vi.fn(),
}));

vi.mock('@/lib/api/workflows', () => workflowsApi);

const directory = vi.hoisted(() => ({
  loadStudentLabelMap: vi.fn(),
  loadStaffLabelMap: vi.fn(),
}));

vi.mock('@/lib/load-entity-labels', () => directory);

const actions = vi.hoisted(() => ({
  decideWorkflowApprovalAction: vi.fn(),
  createWorkflowDefinitionAction: vi.fn(),
}));

vi.mock('./actions', () => actions);

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...workflowsApi, ...directory, ...actions, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  workflowsApi.listPendingApprovalsResult.mockResolvedValue({ ok: true, items: [] });
  workflowsApi.getWorkflowDefinition.mockResolvedValue(DEFINITION);
  workflowsApi.listWorkflowInstancesResult.mockResolvedValue({ ok: true, items: [] });
  workflowsApi.listWorkflowDefinitionsResult.mockResolvedValue({ ok: true, items: [DEFINITION] });
  directory.loadStudentLabelMap.mockResolvedValue(new Map());
  directory.loadStaffLabelMap.mockResolvedValue(new Map());
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
  { path: '/workflows', file: './page.tsx' },
  { path: '/workflows/approvals', file: './approvals/page.tsx' },
  { path: '/workflows/instances', file: './instances/page.tsx' },
  { path: '/workflows/definitions/new', file: './definitions/new/page.tsx' },
  {
    path: '/workflows/definitions/[id]',
    file: './definitions/[id]/page.tsx',
    props: { params: Promise.resolve({ id: DEFINITION.id }) },
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
 * Registrar, HR, health and portal roles hold no gateway workflow grant;
 * UATENV-D25: teacher, staff and platform_admin hold it but the gateway
 * workflow UI plugin refuses them.
 */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['platform_admin'],
  ['registrar'],
  ['hr_officer'],
  ['nurse'],
  ['student'],
  ['guardian'],
  ['parent'],
  [],
];

const ALLOWED_ROLE_SETS = [['admin'], ['principal']];

describe('workflows route guard (A-batch)', () => {
  it('covers every page under /workflows', () => {
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
        expect(screen.queryByText(DEFINITION.name)).toBeNull();
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
