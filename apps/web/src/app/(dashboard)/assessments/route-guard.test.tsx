/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/assessments/**` route is gated on
 * assessment access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no scheme/items/results form, and no assessment,
 * gradebook, institution or student-directory reads.
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

const SCHEME = {
  id: '00000000-0000-4000-8000-0000000000a1',
  tenantId: 'tenant-a',
  name: 'Percentage scheme',
  type: 'numeric',
  minValue: 0,
  maxValue: 100,
  thresholds: [],
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const STUDENT_NAME = 'Asha Rao';

const assessmentsApi = vi.hoisted(() => ({
  getAssessmentItems: vi.fn(),
  listGradingSchemes: vi.fn(),
  listOutcomes: vi.fn(),
  getGradingScheme: vi.fn(),
  getStudentResults: vi.fn(),
}));

vi.mock('@/lib/api/assessments', () => assessmentsApi);

const institutionsApi = vi.hoisted(() => ({
  listAcademicPeriods: vi.fn(),
  listSubjects: vi.fn(),
  listInstitutions: vi.fn(),
}));

vi.mock('@/lib/institutions/api', () => institutionsApi);

const gradebookApi = vi.hoisted(() => ({
  listGradebookSections: vi.fn(),
  listPublishedGradeEntries: vi.fn(),
  listReportCardJobs: vi.fn(),
  listGradeEntries: vi.fn(),
}));

vi.mock('@/lib/api/gradebook', () => ({
  ...gradebookApi,
  readGradeWorkflowStatus: vi.fn(() => 'DRAFT'),
}));

const directory = vi.hoisted(() => ({ loadStudentOptions: vi.fn() }));

vi.mock('@/lib/load-entity-labels', () => directory);

const actions = vi.hoisted(() => ({
  defineAssessmentItemsAction: vi.fn(),
  createGradingSchemeAction: vi.fn(),
  updateGradingSchemeAction: vi.fn(),
  createOutcomeAction: vi.fn(),
}));

vi.mock('./actions', () => actions);

// The grid imports `@proctira/ui/bulk-import`, which the web vitest config does
// not alias; the guard test only needs to know whether the page reached it.
vi.mock('./_components/results-entry-grid', () => ({
  ResultsEntryGrid: () => <form data-testid="results-entry-grid" />,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = {
  ...assessmentsApi,
  ...institutionsApi,
  ...gradebookApi,
  ...directory,
  ...actions,
  fetchSpy,
};

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  assessmentsApi.listGradingSchemes.mockResolvedValue({
    data: [SCHEME],
    meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  });
  assessmentsApi.getGradingScheme.mockResolvedValue(SCHEME);
  assessmentsApi.getAssessmentItems.mockResolvedValue(null);
  assessmentsApi.getStudentResults.mockResolvedValue([]);
  assessmentsApi.listOutcomes.mockResolvedValue([]);
  institutionsApi.listAcademicPeriods.mockResolvedValue([]);
  institutionsApi.listSubjects.mockResolvedValue([]);
  institutionsApi.listInstitutions.mockResolvedValue({ data: [] });
  gradebookApi.listReportCardJobs.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listGradebookSections.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listGradeEntries.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listPublishedGradeEntries.mockResolvedValue({ ok: true, data: [] });
  directory.loadStudentOptions.mockResolvedValue([
    { id: '00000000-0000-4000-8000-0000000000c1', label: STUDENT_NAME },
  ]);
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
}

const NO_SEARCH = { searchParams: Promise.resolve({}) };

const ROUTES: RouteCase[] = [
  { path: '/assessments', file: './page.tsx', props: NO_SEARCH },
  { path: '/assessments/items', file: './items/page.tsx', props: NO_SEARCH },
  { path: '/assessments/outcomes', file: './outcomes/page.tsx', props: NO_SEARCH },
  { path: '/assessments/report-cards', file: './report-cards/page.tsx', props: NO_SEARCH },
  { path: '/assessments/results', file: './results/page.tsx', props: NO_SEARCH },
  { path: '/assessments/schemes/new', file: './schemes/new/page.tsx' },
  {
    path: '/assessments/schemes/[id]/edit',
    file: './schemes/[id]/edit/page.tsx',
    props: { params: Promise.resolve({ id: SCHEME.id }) },
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

/** Non-teaching staff, registrar, platform and portal roles have no assessment read. */
const DENIED_ROLE_SETS = [
  ['staff'],
  ['registrar'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  ['parent'],
  [],
];

const ALLOWED_ROLE_SETS = [['principal'], ['teacher']];

describe('assessments route guard (A-batch)', () => {
  it('covers every page under /assessments', () => {
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
        expect(screen.queryByText(SCHEME.name)).toBeNull();
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
