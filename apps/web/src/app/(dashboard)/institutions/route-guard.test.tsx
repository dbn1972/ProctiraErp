/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/institutions/**` route is gated on
 * institution access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, no institution name, and no institution,
 * timetable, gradebook, curriculum, staff or student reads.
 *
 * Detail tabs under `/institutions/[id]` take their h1 from the `[id]` layout,
 * so for those the allowed case checks the tab's own root test id instead.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Replace every exported function of a server-action module with a spy. */
const stubs = vi.hoisted(() => ({
  stubAll: (mod: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(mod).map(([key, value]) => [
        key,
        typeof value === 'function' ? vi.fn() : value,
      ]),
    ),
}));

const INSTITUTION = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Greenfield Public School',
  code: 'GPS',
  areaId: 'area-1',
  typeId: 'school',
  sectorId: 'private',
  ownershipId: 'private',
  status: 'active',
  latitude: null,
  longitude: null,
  address: null,
  contactPhone: null,
  contactEmail: null,
  deactivationReason: null,
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const SNAPSHOT = {
  studentsAvailable: false,
  students: 0,
  staffAvailable: false,
  staff: 0,
  attendanceAvailable: false,
  attendancePercent: null,
  classroomsAvailable: false,
  classrooms: 0,
  enrollmentAvailable: false,
  enrollmentByGrade: [],
  activityAvailable: false,
  activity: [],
  facts: {},
};

const SECTION = {
  id: '00000000-0000-4000-8000-0000000000d1',
  institutionId: INSTITUTION.id,
  name: 'Grade 5 A',
  code: '5A',
  subjectId: null,
  academicPeriodId: null,
  staffId: null,
  capacity: 40,
  status: 'draft',
};

const JOB = {
  id: '00000000-0000-4000-8000-0000000000e1',
  institutionId: INSTITUTION.id,
  status: 'COMPLETED',
  metadata: {},
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const EMPTY_PAGE = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };

const institutionsApi = vi.hoisted(() => ({
  listAcademicPeriods: vi.fn(),
  listClassesByInstitution: vi.fn(),
  listGrades: vi.fn(),
  listSubjects: vi.fn(),
  getInstitutionOverview: vi.fn(),
  getInfrastructureHierarchy: vi.fn(),
  getInstitution: vi.fn(),
  listInstitutions: vi.fn(),
  listAreaTree: vi.fn(),
}));

vi.mock('@/lib/institutions/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...institutionsApi,
}));

// The real module imports `server-only`; it only memoises the two reads above.
vi.mock('@/lib/institutions/request-cache', () => ({
  getCachedInstitution: (id: string) => institutionsApi.getInstitution(id),
  getCachedInstitutionOverview: (id: string) => institutionsApi.getInstitutionOverview(id),
}));

const directoryApi = vi.hoisted(() => ({ loadInstitutionDirectory: vi.fn() }));

vi.mock('@/lib/institutions/directory', () => directoryApi);

const staffApi = vi.hoisted(() => ({
  listStaff: vi.fn(),
  getStaff: vi.fn(),
  listAllStaffResult: vi.fn(),
}));

vi.mock('@/lib/api/staff', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...staffApi,
}));

const studentsApi = vi.hoisted(() => ({ getStudent: vi.fn(), listStudents: vi.fn() }));

vi.mock('@/lib/api/students', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...studentsApi,
}));

const curriculumApi = vi.hoisted(() => ({
  getCurriculumCoverage: vi.fn(),
  listLearningOutcomes: vi.fn(),
  listLessonPlansForUnits: vi.fn(),
  listSyllabusUnits: vi.fn(),
}));

vi.mock('@/lib/api/curriculum', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...curriculumApi,
}));

const gradebookApi = vi.hoisted(() => ({
  listClassRanks: vi.fn(),
  listCreditRules: vi.fn(),
  listCommentsBank: vi.fn(),
  listGradeEntries: vi.fn(),
  listGradebookSections: vi.fn(),
  listGradingScales: vi.fn(),
  listReportCardJobs: vi.fn(),
}));

vi.mock('@/lib/api/gradebook', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...gradebookApi,
}));

const timetableApi = vi.hoisted(() => ({
  getSection: vi.fn(),
  listPeriods: vi.fn(),
  listRooms: vi.fn(),
  listBellSchedules: vi.fn(),
  listScheduleConflicts: vi.fn(),
  listSections: vi.fn(),
  listGenerationJobs: vi.fn(),
  listMeetings: vi.fn(),
  listAffectedPeriods: vi.fn(),
  listSubstitutions: vi.fn(),
}));

vi.mock('@/lib/api/timetable', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...timetableApi,
}));

const listApi = vi.hoisted(() => ({ fetchList: vi.fn() }));

vi.mock('@/lib/api/list-result', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...listApi,
}));

const tenantApi = vi.hoisted(() => ({ getTenantToday: vi.fn() }));

vi.mock('@/lib/tenant-today', () => tenantApi);

vi.mock('@/lib/institutions/actions', async (importOriginal) =>
  stubs.stubAll(await importOriginal<Record<string, unknown>>()),
);

vi.mock('../gradebook-actions', async (importOriginal) =>
  stubs.stubAll(await importOriginal<Record<string, unknown>>()),
);

vi.mock('../timetable-actions', async (importOriginal) =>
  stubs.stubAll(await importOriginal<Record<string, unknown>>()),
);

vi.mock('./[id]/curriculum/actions', async (importOriginal) =>
  stubs.stubAll(await importOriginal<Record<string, unknown>>()),
);

vi.mock('./[id]/infrastructure/actions', async (importOriginal) =>
  stubs.stubAll(await importOriginal<Record<string, unknown>>()),
);

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = {
  ...institutionsApi,
  ...directoryApi,
  ...staffApi,
  ...studentsApi,
  ...curriculumApi,
  ...gradebookApi,
  ...timetableApi,
  ...listApi,
  ...tenantApi,
  fetchSpy,
};

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  for (const name of [
    'listAcademicPeriods',
    'listClassesByInstitution',
    'listGrades',
    'listSubjects',
    'listAreaTree',
  ] as const) {
    institutionsApi[name].mockResolvedValue([]);
  }
  institutionsApi.getInstitution.mockResolvedValue(INSTITUTION);
  institutionsApi.getInstitutionOverview.mockResolvedValue(SNAPSHOT);
  institutionsApi.getInfrastructureHierarchy.mockResolvedValue({ lands: [] });
  institutionsApi.listInstitutions.mockResolvedValue({
    data: [INSTITUTION],
    meta: { ...EMPTY_PAGE, totalItems: 1, totalPages: 1 },
  });
  directoryApi.loadInstitutionDirectory.mockResolvedValue({
    organizationName: null,
    boardLabel: null,
    studentsEnrolled: null,
    reportingToday: null,
    studentsAvailable: false,
    staffAvailable: false,
    attendanceAvailable: false,
    schools: {},
  });
  staffApi.listStaff.mockResolvedValue({ data: [], meta: EMPTY_PAGE });
  staffApi.getStaff.mockResolvedValue(null);
  staffApi.listAllStaffResult.mockResolvedValue({
    ok: true,
    items: [],
    truncated: false,
    totalItems: 0,
  });
  studentsApi.getStudent.mockResolvedValue(null);
  studentsApi.listStudents.mockResolvedValue({ data: [], meta: EMPTY_PAGE });
  for (const fn of Object.values(curriculumApi)) fn.mockResolvedValue({ ok: true, data: [] });
  for (const fn of Object.values(gradebookApi)) fn.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listReportCardJobs.mockResolvedValue({ ok: true, data: [JOB] });
  for (const fn of Object.values(timetableApi)) fn.mockResolvedValue({ ok: true, data: [] });
  timetableApi.getSection.mockResolvedValue({ ok: true, data: SECTION });
  listApi.fetchList.mockResolvedValue({ ok: true, items: [] });
  tenantApi.getTenantToday.mockResolvedValue('2026-11-01');
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement | undefined> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
  /** Root test id of a detail tab whose h1 lives in the `[id]` layout. */
  screenTestId?: string;
  /** The page only redirects; the allowed case checks the redirect target. */
  redirectsTo?: string;
}

const NO_SEARCH = { searchParams: Promise.resolve({}) };

const ID = { params: Promise.resolve({ id: INSTITUTION.id }), ...NO_SEARCH };

const ROUTES: RouteCase[] = [
  { path: '/institutions', file: './page.tsx', props: NO_SEARCH },
  { path: '/institutions/new', file: './new/page.tsx' },
  {
    path: '/institutions/[id]',
    file: './[id]/page.tsx',
    props: ID,
    redirectsTo: `/institutions/${INSTITUTION.id}/overview`,
  },
  {
    path: '/institutions/[id]/edit',
    file: './[id]/edit/page.tsx',
    props: ID,
    screenTestId: 'institution-profile-form',
  },
  {
    path: '/institutions/[id]/overview',
    file: './[id]/overview/page.tsx',
    props: ID,
    screenTestId: 'institution-overview',
  },
  {
    path: '/institutions/[id]/overview/report',
    file: './[id]/overview/report/page.tsx',
    props: ID,
    screenTestId: 'school-report',
  },
  {
    path: '/institutions/[id]/classes',
    file: './[id]/classes/page.tsx',
    props: ID,
    screenTestId: 'institution-classes',
  },
  {
    path: '/institutions/[id]/grades',
    file: './[id]/grades/page.tsx',
    props: ID,
    screenTestId: 'institution-grades',
  },
  {
    path: '/institutions/[id]/curriculum',
    file: './[id]/curriculum/page.tsx',
    props: ID,
    screenTestId: 'institution-curriculum',
  },
  {
    path: '/institutions/[id]/gradebook',
    file: './[id]/gradebook/page.tsx',
    props: ID,
    screenTestId: 'institution-gradebook',
  },
  {
    path: '/institutions/[id]/gradebook/report-cards/[jobId]',
    file: './[id]/gradebook/report-cards/[jobId]/page.tsx',
    props: { params: Promise.resolve({ id: INSTITUTION.id, jobId: JOB.id }) },
  },
  {
    path: '/institutions/[id]/infrastructure',
    file: './[id]/infrastructure/page.tsx',
    props: ID,
    screenTestId: 'institution-infrastructure',
  },
  {
    path: '/institutions/[id]/schedule',
    file: './[id]/schedule/page.tsx',
    props: ID,
    screenTestId: 'institution-schedule',
  },
  {
    path: '/institutions/[id]/schedule/[sectionId]',
    file: './[id]/schedule/[sectionId]/page.tsx',
    props: { params: Promise.resolve({ id: INSTITUTION.id, sectionId: SECTION.id }) },
    screenTestId: 'institution-schedule-section',
  },
  {
    path: '/institutions/[id]/timetable',
    file: './[id]/timetable/page.tsx',
    props: ID,
    screenTestId: 'institution-timetable',
  },
  {
    path: '/institutions/[id]/timetable/generate',
    file: './[id]/timetable/generate/page.tsx',
    props: ID,
    screenTestId: 'timetable-generate-page',
  },
  {
    path: '/institutions/[id]/timetable/substitutions',
    file: './[id]/timetable/substitutions/page.tsx',
    props: ID,
    screenTestId: 'timetable-substitutions-page',
  },
];

async function renderRoute(route: RouteCase) {
  const { default: Page } = await PAGES[route.file]!();
  const element = await Page((route.props ?? {}) as never);
  render(element ?? <></>);
}

beforeEach(() => {
  resetFetches();
  vi.mocked(redirect).mockClear();
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

const ALLOWED_ROLE_SETS = [['admin'], ['teacher']];

describe('institutions route guard (A-batch)', () => {
  it('covers every page under /institutions', () => {
    expect(ROUTES.map((r) => r.file).sort()).toEqual(Object.keys(PAGES).sort());
  });

  describe.each(ROUTES)('$path', (route) => {
    it.each(DENIED_ROLE_SETS.map((roles) => [roles.join('+') || 'no roles', roles]))(
      'renders access denied with no UI or reads for %s',
      async (_label, roles) => {
        auth.state.roles = roles as string[];
        await renderRoute(route);
        expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(document.querySelector('form')).toBeNull();
        expect(screen.queryByText(INSTITUTION.name)).toBeNull();
        expect(redirect).not.toHaveBeenCalled();
        for (const [name, fn] of Object.entries(allFetches)) {
          expect(fn, `${name} must not be called`).not.toHaveBeenCalled();
        }
      },
    );

    it.each(ALLOWED_ROLE_SETS.map((roles) => [roles.join('+'), roles]))(
      'renders the screen for %s',
      async (_label, roles) => {
        auth.state.roles = roles as string[];
        await renderRoute(route);
        expect(screen.queryByTestId('route-access-denied')).toBeNull();
        if (route.redirectsTo) {
          expect(redirect).toHaveBeenCalledWith(route.redirectsTo);
        } else if (route.screenTestId) {
          expect(screen.getByTestId(route.screenTestId)).toBeInTheDocument();
        } else {
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        }
      },
    );
  });
});
