/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/scholarships/**` route is gated on
 * scholarship officer access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, no program or applicant name, and no
 * scholarship, institution or student reads.
 *
 * The client forms, tabs and panels are stubbed: this file tests the
 * page-level check, and the components have their own tests.
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

const PROGRAM = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Northstar Merit Award',
  code: 'NMA',
  totalSlots: 10,
  awardAmount: 5000,
  currency: 'INR',
  applicationStartDate: '2026-01-01',
  applicationEndDate: '2026-12-31',
  status: 'OPEN',
  description: null,
};

const APPLICATION = {
  id: '00000000-0000-4000-8000-0000000000b1',
  applicantName: 'Meera Pillai',
  applicantId: '00000000-0000-4000-8000-0000000000c1',
  programId: PROGRAM.id,
  programName: PROGRAM.name,
  submittedAt: '2026-02-01',
  status: 'PENDING',
  totalScore: null,
  reviewedAt: null,
  reviewerId: null,
  reviewNotes: null,
};

const PAGED = (items: unknown[]) => ({
  ok: true,
  items,
  meta: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 },
});

const scholarshipsApi = vi.hoisted(() => ({
  getScholarshipApplication: vi.fn(),
  getScholarshipProgram: vi.fn(),
  listScholarshipApplications: vi.fn(),
  listScholarshipDisbursements: vi.fn(),
  listScholarshipPrograms: vi.fn(),
}));
vi.mock('@/lib/api/scholarships', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...scholarshipsApi,
}));

const institutionsApi = vi.hoisted(() => ({ listInstitutions: vi.fn() }));
vi.mock('@/lib/api/institutions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...institutionsApi,
}));

const directory = vi.hoisted(() => ({ loadStudentOptions: vi.fn() }));
vi.mock('@/lib/load-entity-labels', () => directory);

vi.mock('@/features/scholarships/pages/ScholarshipApplication', () => ({
  default: () => <form aria-label="Scholarship application" />,
}));
vi.mock('@/features/scholarships/components/application-documents-panel', () => ({
  ApplicationDocumentsPanel: () => null,
}));
vi.mock('./_components/application-decision-form', () => ({
  ApplicationDecisionForm: () => null,
}));
vi.mock('./_components/application-status-tabs', () => ({ ApplicationStatusTabs: () => null }));
vi.mock('./_components/applications-export-button', () => ({
  ApplicationsExportButton: () => null,
}));
vi.mock('./_components/retry-failed-transfers-button', () => ({
  RetryFailedTransfersButton: () => null,
}));
vi.mock('./_components/edit-program-form', () => ({
  EditProgramForm: () => <form aria-label="Edit program" />,
}));
vi.mock('./_components/new-program-form', () => ({
  NewProgramForm: () => <form aria-label="New program" />,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () =>
    Object.assign((key: string) => key, { rich: (key: string) => key }),
  ),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = { ...scholarshipsApi, ...institutionsApi, ...directory, fetchSpy };

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  scholarshipsApi.getScholarshipApplication.mockResolvedValue(APPLICATION);
  scholarshipsApi.getScholarshipProgram.mockResolvedValue(PROGRAM);
  scholarshipsApi.listScholarshipApplications.mockResolvedValue(PAGED([APPLICATION]));
  scholarshipsApi.listScholarshipDisbursements.mockResolvedValue(PAGED([]));
  scholarshipsApi.listScholarshipPrograms.mockResolvedValue(PAGED([PROGRAM]));
  institutionsApi.listInstitutions.mockResolvedValue([]);
  directory.loadStudentOptions.mockResolvedValue([]);
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
  { path: '/scholarships', file: './page.tsx' },
  { path: '/scholarships/applications', file: './applications/page.tsx', props: NO_SEARCH },
  {
    path: '/scholarships/applications/[id]',
    file: './applications/[id]/page.tsx',
    props: { params: Promise.resolve({ id: APPLICATION.id }) },
  },
  { path: '/scholarships/apply', file: './apply/page.tsx' },
  { path: '/scholarships/disbursements', file: './disbursements/page.tsx', props: NO_SEARCH },
  { path: '/scholarships/programs/new', file: './programs/new/page.tsx' },
  {
    path: '/scholarships/programs/[id]',
    file: './programs/[id]/page.tsx',
    props: { params: Promise.resolve({ id: PROGRAM.id }) },
  },
  {
    path: '/scholarships/programs/[id]/edit',
    file: './programs/[id]/edit/page.tsx',
    props: { params: Promise.resolve({ id: PROGRAM.id }) },
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

/** Teaching, office, registrar, admissions, platform and student roles are not officers. */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['registrar'],
  ['admissions_officer'],
  ['platform_admin'],
  ['student'],
  [],
];

const ALLOWED_ROLE_SETS = [['admin'], ['super-admin']];

describe('scholarships route guard (A-batch)', () => {
  it('covers every page under /scholarships', () => {
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
        expect(screen.queryByText(new RegExp(PROGRAM.name))).toBeNull();
        expect(screen.queryByText(new RegExp(APPLICATION.applicantName))).toBeNull();
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
