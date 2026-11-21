/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/lms/**` route is gated on LMS staff
 * access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, no assignment title, and no LMS, gradebook,
 * institution or student reads.
 *
 * The client forms, pills and subnav are stubbed: this file tests the
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

const ASSIGNMENT = {
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'assignment',
  scope: 'school',
  status: 'published',
  title: 'Fractions worksheet',
  subject: 'Maths',
  gradeLevel: null,
  dueAt: null,
  maxScore: 10,
  questions: [],
};

const lmsApi = vi.hoisted(() => ({
  getAssignment: vi.fn(),
  getQuizAnalytics: vi.fn(),
  getRubric: vi.fn(),
  listAssignmentFiles: vi.fn(),
  listSubmissions: vi.fn(),
  getClassAnalytics: vi.fn(),
  listAssignments: vi.fn(),
  listAssignmentsPage: vi.fn(),
  listBankQuestions: vi.fn(),
  listSkills: vi.fn(),
  listContentItems: vi.fn(),
  listDiscussions: vi.fn(),
  listLessons: vi.fn(),
  listRubricsResult: vi.fn(),
}));
vi.mock('@/lib/api/lms', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...lmsApi,
}));

const gradebookApi = vi.hoisted(() => ({ listGradebookBoards: vi.fn() }));
vi.mock('@/lib/api/gradebook', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...gradebookApi,
}));

const institutionsApi = vi.hoisted(() => ({ listInstitutions: vi.fn() }));
vi.mock('@/lib/api/institutions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...institutionsApi,
}));

const directory = vi.hoisted(() => ({
  loadInstitutionOptions: vi.fn(),
  loadStudentLabelsForIds: vi.fn(),
}));
vi.mock('@/lib/load-entity-labels', () => directory);

const writeGuard = vi.hoisted(() => ({ canWrite: vi.fn() }));
vi.mock('@/lib/auth/route-write-guard', () => writeGuard);

vi.mock('./_components/badges', () => ({
  KindPill: () => null,
  ScopePill: () => null,
  StatusPill: () => null,
  SubmissionPill: () => null,
}));
vi.mock('./_components/kpi-card', () => ({ KpiCard: () => null }));
vi.mock('./_components/lms-subnav', () => ({ LmsSubnav: () => null }));
vi.mock('./_components/assignment-lifecycle', () => ({ AssignmentLifecycle: () => null }));
vi.mock('./_components/depth-grade-forms', () => ({
  AssignmentFileForm: () => null,
  RubricGradeForm: () => null,
}));
vi.mock('./_components/grade-submission-form', () => ({ GradeSubmissionForm: () => null }));
vi.mock('./_components/new-assignment-form', () => ({ NewAssignmentForm: () => null }));
vi.mock('./_components/bank-item-form', () => ({ BankItemForm: () => null }));
vi.mock('./_components/content-form', () => ({ ContentForm: () => null }));
vi.mock('./_components/discussion-forms', () => ({
  DiscussionCreateForm: () => null,
  DiscussionModeration: () => null,
}));
vi.mock('./_components/lesson-form', () => ({ LessonForm: () => null }));
vi.mock('./_components/resource-link', () => ({ ResourceLink: () => null }));
vi.mock('./_components/new-skill-form', () => ({ NewSkillForm: () => null }));
vi.mock('./_components/pal-lookup', () => ({ PalLookup: () => null }));
vi.mock('./_components/rubric-form', () => ({ RubricForm: () => null }));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () =>
    Object.assign((key: string) => key, { rich: (key: string) => key }),
  ),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = {
  ...lmsApi,
  ...gradebookApi,
  ...institutionsApi,
  ...directory,
  ...writeGuard,
  fetchSpy,
};

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  lmsApi.getAssignment.mockResolvedValue(ASSIGNMENT);
  lmsApi.getQuizAnalytics.mockResolvedValue(null);
  lmsApi.getRubric.mockResolvedValue(null);
  lmsApi.listAssignmentFiles.mockResolvedValue([]);
  lmsApi.listSubmissions.mockResolvedValue([]);
  lmsApi.getClassAnalytics.mockResolvedValue(null);
  lmsApi.listAssignments.mockResolvedValue([ASSIGNMENT]);
  lmsApi.listAssignmentsPage.mockResolvedValue({ ok: true, items: [], meta: { totalItems: 0 } });
  lmsApi.listBankQuestions.mockResolvedValue([]);
  lmsApi.listSkills.mockResolvedValue([]);
  lmsApi.listContentItems.mockResolvedValue([]);
  lmsApi.listDiscussions.mockResolvedValue([]);
  lmsApi.listLessons.mockResolvedValue([]);
  lmsApi.listRubricsResult.mockResolvedValue({ ok: true, items: [] });
  gradebookApi.listGradebookBoards.mockResolvedValue({ ok: true, data: [] });
  institutionsApi.listInstitutions.mockResolvedValue([]);
  directory.loadInstitutionOptions.mockResolvedValue([]);
  directory.loadStudentLabelsForIds.mockResolvedValue(new Map());
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

const NO_SEARCH = { searchParams: Promise.resolve({}) };

const ROUTES: RouteCase[] = [
  { path: '/lms', file: './page.tsx', props: NO_SEARCH },
  { path: '/lms/analytics', file: './analytics/page.tsx', props: NO_SEARCH },
  { path: '/lms/assignments/new', file: './assignments/new/page.tsx', props: NO_SEARCH },
  {
    path: '/lms/assignments/[id]',
    file: './assignments/[id]/page.tsx',
    props: { params: Promise.resolve({ id: ASSIGNMENT.id }) },
  },
  { path: '/lms/bank', file: './bank/page.tsx', props: NO_SEARCH },
  { path: '/lms/content', file: './content/page.tsx' },
  { path: '/lms/discussions', file: './discussions/page.tsx' },
  { path: '/lms/lessons', file: './lessons/page.tsx' },
  { path: '/lms/pal', file: './pal/page.tsx', props: NO_SEARCH },
  { path: '/lms/rubrics', file: './rubrics/page.tsx' },
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

/** Office, registrar, platform and portal roles hold no LMS staff read. */
const DENIED_ROLE_SETS = [
  ['staff'],
  ['registrar'],
  ['platform_admin'],
  ['student'],
  ['parent'],
  [],
];

const ALLOWED_ROLE_SETS = [['teacher'], ['principal']];

describe('lms route guard (A-batch)', () => {
  it('covers every page under /lms', () => {
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
        expect(screen.queryByText(ASSIGNMENT.title)).toBeNull();
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
